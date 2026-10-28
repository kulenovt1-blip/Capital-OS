/**
 * Read-only ридер формата SQLite 3 (https://www.sqlite.org/fileformat.html).
 *
 * Умеет ровно то, что нужно для импорта бэкапа: прочитать схему и сделать полный обход
 * rowid-таблиц (b-tree таблиц, overflow-страницы, все типы записей, UTF-8/UTF-16).
 * Индексы, WAL, WITHOUT ROWID и запись не поддерживаются.
 *
 * Интерфейс SqliteDb — граница: при желании его можно реализовать поверх sql.js.
 */

export type SqlValue = null | number | bigint | string | Uint8Array;

export interface ColumnDef {
  name: string;
  type: string;
  default: SqlValue;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  /** Индекс колонки-алиаса rowid (INTEGER PRIMARY KEY) или -1. */
  rowidAlias: number;
  withoutRowid: boolean;
}

export interface SqliteTable {
  name: string;
  columns: string[];
  rows: SqlValue[][];
}

export interface SqliteDb {
  tableNames(): string[];
  hasTable(name: string): boolean;
  table(name: string): SqliteTable;
  readObjects(name: string): Record<string, SqlValue>[];
}

// ---------------------------------------------------------------- SQL: разбор CREATE TABLE

interface Token {
  kind: 'word' | 'quoted' | 'string' | 'number' | 'punct';
  value: string;
}

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= sql.length) throw new Error('SQL: незакрытая кавычка');
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) {
            v += close;
            j += 2;
            continue;
          }
          break;
        }
        v += sql[j++];
      }
      out.push({ kind: ch === "'" ? 'string' : 'quoted', value: v });
      i = j + 1;
    } else if (/[0-9.]/.test(ch) && /[0-9]/.test(sql[i + (ch === '.' ? 1 : 0)] ?? '')) {
      const m = /^(0x[0-9a-f]+|\d*\.?\d+(e[+-]?\d+)?|\d+\.(e[+-]?\d+)?)/i.exec(sql.slice(i))!;
      out.push({ kind: 'number', value: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_\u0080-￿]/.test(ch)) {
      const m = /^[A-Za-z_0-9$\u0080-￿]+/.exec(sql.slice(i))!;
      out.push({ kind: 'word', value: m[0] });
      i += m[0].length;
    } else {
      out.push({ kind: 'punct', value: ch });
      i++;
    }
  }
  return out;
}

const isWord = (t: Token | undefined, w: string) => t?.kind === 'word' && t.value.toUpperCase() === w;
const TABLE_CONSTRAINTS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN']);
const COLUMN_CONSTRAINTS = new Set(['CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'REFERENCES', 'GENERATED', 'AS']);

function parseDefault(tokens: Token[], i: number): SqlValue {
  let t = tokens[i];
  if (!t) return null;
  let sign = 1;
  if (t.kind === 'punct' && (t.value === '-' || t.value === '+')) {
    if (t.value === '-') sign = -1;
    t = tokens[i + 1];
    if (!t) return null;
  }
  if (t.kind === 'number') return sign * Number(t.value);
  if (t.kind === 'string') return t.value;
  if (t.kind === 'word') {
    const u = t.value.toUpperCase();
    if (u === 'NULL' || u.startsWith('CURRENT_')) return null;
    if (u === 'TRUE') return 1;
    if (u === 'FALSE') return 0;
    return t.value;
  }
  if (t.kind === 'quoted') return t.value;
  return null; // выражение в скобках не вычисляем
}

function splitTopLevel(tokens: Token[]): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'punct' && t.value === '(') depth++;
    if (t.kind === 'punct' && t.value === ')') depth--;
    if (depth === 0 && t.kind === 'punct' && t.value === ',') parts.push([]);
    else parts[parts.length - 1]!.push(t);
  }
  return parts.filter((p) => p.length > 0);
}

function identList(tokens: Token[], from: number): string[] {
  // ожидает «( a, b DESC, c )» начиная с from
  const names: string[] = [];
  let i = from;
  if (!(tokens[i]?.kind === 'punct' && tokens[i]!.value === '(')) return names;
  i++;
  let expectName = true;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'punct' && t.value === ')') break;
    if (t.kind === 'punct' && t.value === ',') {
      expectName = true;
      continue;
    }
    if (expectName && (t.kind === 'word' || t.kind === 'quoted')) {
      names.push(t.value);
      expectName = false;
    }
  }
  return names;
}

export function parseCreateTable(sql: string): TableDef {
  const tokens = tokenize(sql);
  let i = 0;
  if (!isWord(tokens[i++], 'CREATE')) throw new Error(`SQL: ожидался CREATE TABLE: ${sql.slice(0, 60)}`);
  if (isWord(tokens[i], 'TEMP') || isWord(tokens[i], 'TEMPORARY')) i++;
  if (!isWord(tokens[i++], 'TABLE')) throw new Error(`SQL: ожидался CREATE TABLE: ${sql.slice(0, 60)}`);
  if (isWord(tokens[i], 'IF')) i += 3;
  let name = tokens[i++]!.value;
  if (tokens[i]?.kind === 'punct' && tokens[i]!.value === '.') name = tokens[(i += 2) - 1]!.value;
  if (!(tokens[i]?.kind === 'punct' && tokens[i]!.value === '(')) throw new Error(`SQL: CREATE TABLE ... AS SELECT не поддерживается (${name})`);
  // найти закрывающую скобку
  let depth = 0;
  let end = i;
  for (; end < tokens.length; end++) {
    const t = tokens[end]!;
    if (t.kind === 'punct' && t.value === '(') depth++;
    if (t.kind === 'punct' && t.value === ')' && --depth === 0) break;
  }
  const body = tokens.slice(i + 1, end);
  const tail = tokens.slice(end + 1);
  const withoutRowid = tail.some((t, k) => isWord(t, 'WITHOUT') && isWord(tail[k + 1], 'ROWID'));

  const columns: ColumnDef[] = [];
  let colPk = -1;
  let tablePk: string[] = [];
  for (const def of splitTopLevel(body)) {
    const first = def[0]!;
    if (first.kind === 'word' && TABLE_CONSTRAINTS.has(first.value.toUpperCase())) {
      let k = 0;
      if (isWord(def[k], 'CONSTRAINT')) k += 2;
      if (isWord(def[k], 'PRIMARY') && isWord(def[k + 1], 'KEY')) tablePk = identList(def, k + 2);
      continue;
    }
    const typeWords: string[] = [];
    let k = 1;
    let depthT = 0;
    for (; k < def.length; k++) {
      const t = def[k]!;
      if (depthT === 0 && t.kind === 'word' && COLUMN_CONSTRAINTS.has(t.value.toUpperCase())) break;
      if (t.kind === 'punct' && t.value === '(') depthT++;
      if (t.kind === 'punct' && t.value === ')') depthT--;
      if (t.kind === 'word' && depthT === 0) typeWords.push(t.value.toUpperCase());
    }
    let dflt: SqlValue = null;
    let isPk = false;
    for (; k < def.length; k++) {
      if (isWord(def[k], 'DEFAULT')) dflt = parseDefault(def, k + 1);
      if (isWord(def[k], 'PRIMARY') && isWord(def[k + 1], 'KEY') && !isWord(def[k + 2], 'DESC')) isPk = true;
    }
    const type = typeWords.join(' ');
    if (isPk && type === 'INTEGER') colPk = columns.length;
    columns.push({ name: first.value, type, default: dflt });
  }
  let rowidAlias = colPk;
  if (rowidAlias < 0 && tablePk.length === 1) {
    const idx = columns.findIndex((c) => c.name.toLowerCase() === tablePk[0]!.toLowerCase());
    if (idx >= 0 && columns[idx]!.type === 'INTEGER') rowidAlias = idx;
  }
  if (withoutRowid) rowidAlias = -1;
  return { name, columns, rowidAlias, withoutRowid };
}

// ---------------------------------------------------------------- Файл: страницы и записи

const HEADER = 'SQLite format 3\u0000';

class FileReader {
  readonly dv: DataView;
  readonly pageSize: number;
  readonly usable: number;
  readonly textDecoder: TextDecoder;

  constructor(readonly bytes: Uint8Array) {
    if (bytes.length < 100) throw new Error('Это не база SQLite: файл слишком короткий');
    for (let i = 0; i < 16; i++) {
      if (bytes[i] !== HEADER.charCodeAt(i)) throw new Error('Это не база SQLite: нет заголовка «SQLite format 3»');
    }
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ps = this.dv.getUint16(16);
    this.pageSize = ps === 1 ? 65536 : ps;
    this.usable = this.pageSize - bytes[20]!;
    const enc = this.dv.getUint32(56);
    this.textDecoder = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
  }

  pageOffset(n: number): number {
    const off = (n - 1) * this.pageSize;
    if (n < 1 || off + this.pageSize > this.bytes.length) throw new Error(`SQLite: страница ${n} за пределами файла — файл повреждён`);
    return off;
  }

  varint(p: number): [number | bigint, number] {
    const b = this.bytes;
    let v = 0;
    for (let i = 0; i < 7; i++) {
      const x = b[p + i]!;
      v = v * 128 + (x & 0x7f);
      if (!(x & 0x80)) return [v, i + 1];
    }
    // 8-й и 9-й байты: переходим в BigInt
    let big = BigInt(v);
    const x8 = b[p + 7]!;
    big = big * 128n + BigInt(x8 & 0x7f);
    if (!(x8 & 0x80)) return [toNum(big), 8];
    big = big * 256n + BigInt(b[p + 8]!);
    if (big >= 1n << 63n) big -= 1n << 64n;
    return [toNum(big), 9];
  }

  /** Полезная нагрузка ячейки листа таблицы с учётом overflow-страниц. */
  payload(start: number, total: number): Uint8Array {
    const U = this.usable;
    const X = U - 35;
    if (total <= X) return this.bytes.subarray(start, start + total);
    const M = Math.floor(((U - 12) * 32) / 255) - 23;
    const K = M + ((total - M) % (U - 4));
    const local = K <= X ? K : M;
    const out = new Uint8Array(total);
    out.set(this.bytes.subarray(start, start + local), 0);
    let filled = local;
    let next = this.dv.getUint32(start + local);
    let guard = 0;
    while (filled < total) {
      if (next === 0 || ++guard > 1_000_000) throw new Error('SQLite: оборвана цепочка overflow-страниц');
      const off = this.pageOffset(next);
      const chunk = Math.min(U - 4, total - filled);
      out.set(this.bytes.subarray(off + 4, off + 4 + chunk), filled);
      filled += chunk;
      next = this.dv.getUint32(off);
    }
    return out;
  }

  record(payload: Uint8Array): SqlValue[] {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const [hdrSizeRaw, n0] = this.varintIn(payload, 0);
    const hdrSize = Number(hdrSizeRaw);
    const types: number[] = [];
    let p = n0;
    while (p < hdrSize) {
      const [t, n] = this.varintIn(payload, p);
      types.push(Number(t));
      p += n;
    }
    const values: SqlValue[] = [];
    let d = hdrSize;
    for (const t of types) {
      switch (t) {
        case 0:
          values.push(null);
          break;
        case 1:
          values.push(dv.getInt8(d));
          d += 1;
          break;
        case 2:
          values.push(dv.getInt16(d));
          d += 2;
          break;
        case 3: {
          let v = (payload[d]! << 16) | (payload[d + 1]! << 8) | payload[d + 2]!;
          if (v & 0x800000) v -= 0x1000000;
          values.push(v);
          d += 3;
          break;
        }
        case 4:
          values.push(dv.getInt32(d));
          d += 4;
          break;
        case 5:
          values.push(dv.getInt16(d) * 4294967296 + dv.getUint32(d + 2));
          d += 6;
          break;
        case 6:
          values.push(toNum(dv.getBigInt64(d)));
          d += 8;
          break;
        case 7:
          values.push(dv.getFloat64(d));
          d += 8;
          break;
        case 8:
          values.push(0);
          break;
        case 9:
          values.push(1);
          break;
        default: {
          if (t < 12) throw new Error(`SQLite: зарезервированный тип записи ${t}`);
          const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
          const raw = payload.subarray(d, d + len);
          values.push(t % 2 === 0 ? raw.slice() : this.textDecoder.decode(raw));
          d += len;
        }
      }
    }
    return values;
  }

  private varintIn(buf: Uint8Array, p: number): [number | bigint, number] {
    let v = 0;
    for (let i = 0; i < 9; i++) {
      const x = buf[p + i]!;
      if (i === 8) return [v * 256 + x, 9];
      v = v * 128 + (x & 0x7f);
      if (!(x & 0x80)) return [v, i + 1];
    }
    return [v, 9];
  }

  /** Обход b-дерева таблицы по порядку rowid. */
  scanTable(rootPage: number, onRow: (rowid: number | bigint, payload: Uint8Array) => void): void {
    const visited = new Set<number>();
    const walk = (page: number, depth: number): void => {
      if (depth > 64 || visited.has(page)) throw new Error('SQLite: цикл в b-дереве — файл повреждён');
      visited.add(page);
      const base = this.pageOffset(page);
      const h = page === 1 ? base + 100 : base;
      const type = this.bytes[h]!;
      const nCells = this.dv.getUint16(h + 3);
      if (type === 0x0d) {
        for (let c = 0; c < nCells; c++) {
          const cell = base + this.dv.getUint16(h + 8 + c * 2);
          const [plen, n1] = this.varint(cell);
          const [rowid, n2] = this.varint(cell + n1);
          onRow(rowid, this.payload(cell + n1 + n2, Number(plen)));
        }
      } else if (type === 0x05) {
        for (let c = 0; c < nCells; c++) {
          const cell = base + this.dv.getUint16(h + 12 + c * 2);
          walk(this.dv.getUint32(cell), depth + 1);
        }
        walk(this.dv.getUint32(h + 8), depth + 1);
      } else {
        throw new Error(`SQLite: страница ${page} не является страницей таблицы (тип ${type})`);
      }
    };
    walk(rootPage, 0);
  }
}

function toNum(v: bigint): number | bigint {
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
}

interface SchemaEntry {
  def: TableDef;
  rootPage: number;
}

export function openSqlite(bytes: Uint8Array): SqliteDb {
  const f = new FileReader(bytes);
  const schema = new Map<string, SchemaEntry>();
  f.scanTable(1, (_rowid, payload) => {
    const [type, name, , rootpage, sql] = f.record(payload);
    if (type !== 'table' || typeof name !== 'string' || typeof sql !== 'string') return;
    if (name.startsWith('sqlite_')) return;
    const def = parseCreateTable(sql);
    schema.set(name.toLowerCase(), { def: { ...def, name }, rootPage: Number(rootpage) });
  });

  const get = (name: string): SchemaEntry => {
    const e = schema.get(name.toLowerCase());
    if (!e) throw new Error(`В базе нет таблицы «${name}»`);
    if (e.def.withoutRowid) throw new Error(`Таблица «${name}» — WITHOUT ROWID, не поддерживается`);
    return e;
  };

  const db: SqliteDb = {
    tableNames: () => [...schema.values()].map((e) => e.def.name),
    hasTable: (name) => schema.has(name.toLowerCase()),
    table(name) {
      const { def, rootPage } = get(name);
      const rows: SqlValue[][] = [];
      const nCols = def.columns.length;
      f.scanTable(rootPage, (rowid, payload) => {
        const values = f.record(payload);
        // колонки, добавленные через ALTER TABLE после записи строки, получают DEFAULT
        for (let i = values.length; i < nCols; i++) values.push(def.columns[i]!.default);
        if (values.length > nCols) values.length = nCols;
        if (def.rowidAlias >= 0) values[def.rowidAlias] = rowid;
        rows.push(values);
      });
      return { name: def.name, columns: def.columns.map((c) => c.name), rows };
    },
    readObjects(name) {
      const t = db.table(name);
      return t.rows.map((r) => {
        const o: Record<string, SqlValue> = {};
        t.columns.forEach((c, i) => (o[c] = r[i] ?? null));
        return o;
      });
    },
  };
  return db;
}
