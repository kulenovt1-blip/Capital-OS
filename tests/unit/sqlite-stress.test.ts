/**
 * Стресс-тест собственного SQLite-ридера на базе, похожей на настоящую базу Android-приложения:
 * тысячи строк, физические DELETE (freelist), длинные комментарии (overflow), индексы,
 * auto_vacuum (pointer-map страницы), разные размеры страниц, кириллица.
 * База строится настоящим SQLite (node:sqlite) во время теста и сравнивается построчно.
 * Это снижает риск BLOCKERS B2: реального бэкапа нет, а формат файла — тот же SQLite.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../../engine/import/sqlite';
import { importMmbackup } from '../../engine/import/mmbackup';
import { reconcileAccounts } from '../../engine/ledger';
import { writeZip, concat } from '../support/zip-writer';

// node:sqlite есть в Node ≥ 22.5 и в Bun. Берётся через process.getBuiltinModule — мимо загрузчика Vitest 2,
// который не считает node:sqlite встроенным модулем (из-за этого тест раньше тихо пропускался под Vitest).
type SqliteMod = typeof import('node:sqlite');
const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
const sqliteMod: SqliteMod | null = ((getBuiltin?.('node:sqlite') as SqliteMod | undefined) ?? (await import('node:sqlite').catch(() => null))) || null;
const DatabaseSync = sqliteMod?.DatabaseSync as SqliteMod['DatabaseSync'];

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const nodeHasSqlite = major > 22 || (major === 22 && minor >= 5);

describe('окружение стресс-теста', () => {
  it('на Node ≥ 22.5 node:sqlite доступен — иначе стресс-тест молча пропускался бы', () => {
    if (nodeHasSqlite) expect(sqliteMod, `Node ${process.versions.node}: node:sqlite не загрузился`).not.toBeNull();
  });
});

const TMP = fileURLToPath(new URL('../.tmp/', import.meta.url));
mkdirSync(TMP, { recursive: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['продукты', 'Magnum', 'Kaspi', 'такси', 'кофе', 'мама', 'рассрочка', 'телефон', 'обед', 'Әлем', 'қарыз', '🙂', 'аренда', 'стипендия'];

interface Variant {
  name: string;
  pageSize: number;
  autoVacuum: 0 | 1 | 2;
  tx: number;
  seed: number;
}

function build(v: Variant): { path: string; balances: Record<string, number> } {
  const path = `${TMP}${v.name}.db`;
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA page_size = ${v.pageSize}; PRAGMA auto_vacuum = ${v.autoVacuum};`);
  db.exec(`
    CREATE TABLE android_metadata (locale TEXT);
    INSERT INTO android_metadata VALUES ('ru_RU');
    CREATE TABLE account (uid TEXT PRIMARY KEY, title TEXT, currencyCode TEXT, ignoreInBalance INTEGER, isArchived INTEGER, isRemoved INTEGER, color INTEGER);
    CREATE TABLE account_balance (uid TEXT PRIMARY KEY, value INTEGER);
    CREATE TABLE category (uid TEXT PRIMARY KEY, title TEXT, type TEXT, icon TEXT, isRemoved INTEGER);
    CREATE TABLE tag (uid TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE "transaction" (uid TEXT PRIMARY KEY, type TEXT, amount INTEGER, amountInDefaultCurrency INTEGER, date TEXT, comment TEXT, isRemoved INTEGER, createdAt INTEGER, rate REAL);
    CREATE TABLE transfer (uid TEXT PRIMARY KEY, fromAmount INTEGER, toAmount INTEGER, date TEXT, comment TEXT, isRemoved INTEGER);
    CREATE TABLE sync_link (id INTEGER PRIMARY KEY AUTOINCREMENT, entityType TEXT, entityUid TEXT, otherType TEXT, otherUid TEXT, isRemoved INTEGER);
    CREATE INDEX idx_link_entity ON sync_link(entityUid);
    CREATE INDEX idx_tx_date ON "transaction"(date);
  `);
  const r = prng(v.seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const accs = ['a-kaspi', 'a-cash', 'a-halyk', 'a-dep'];
  const cats = ['c-food', 'c-taxi', 'c-salary', 'c-inst', 'c-gift'];
  db.exec('BEGIN');
  for (const a of accs) db.prepare('INSERT INTO account VALUES (?,?,?,?,?,?,?)').run(a, `Счёт ${a}`, 'KZT', 0, 0, 0, Math.floor(r() * 1e6));
  for (const c of cats) db.prepare('INSERT INTO category VALUES (?,?,?,?,?)').run(c, c === 'c-gift' ? '' : `Кат ${c}`, c === 'c-salary' || c === 'c-gift' ? 'Income' : 'Expense', `ic_${c}`, 0);
  for (let i = 0; i < 20; i++) db.prepare('INSERT INTO tag VALUES (?,?)').run(`t-${i}`, pick(WORDS));
  const link = db.prepare('INSERT INTO sync_link(entityType, entityUid, otherType, otherUid, isRemoved) VALUES (?,?,?,?,?)');
  const insTx = db.prepare('INSERT INTO "transaction" VALUES (?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < v.tx; i++) {
    const uid = `tx-${v.seed}-${String(i).padStart(6, '0')}`;
    const income = r() < 0.15;
    const amount = Math.floor(r() * 5_000_000) + 1;
    const d = `20${24 + Math.floor(r() * 3)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
    const words = Array.from({ length: Math.floor(r() * (r() < 0.05 ? 900 : 6)) }, () => pick(WORDS)).join(' ');
    insTx.run(uid, income ? 'Income' : 'Expense', amount, amount, d, words, r() < 0.03 ? 1 : 0, 1_700_000_000_000 + i, r() < 0.5 ? null : r() * 3);
    link.run('Transaction', uid, 'Account', pick(accs), 0);
    if (r() < 0.9) link.run('Transaction', uid, 'Category', income ? pick(['c-salary', 'c-gift']) : pick(['c-food', 'c-taxi', 'c-inst']), 0);
    if (r() < 0.3) link.run('Transaction', uid, 'Tag', `t-${Math.floor(r() * 20)}`, r() < 0.1 ? 1 : 0);
  }
  for (let i = 0; i < v.tx / 15; i++) {
    const uid = `tr-${v.seed}-${i}`;
    const amt = Math.floor(r() * 1_000_000) + 1;
    db.prepare('INSERT INTO transfer VALUES (?,?,?,?,?,?)').run(uid, amt, r() < 0.3 ? null : amt, '2025-06-15', 'перевод', 0);
    const from = pick(accs);
    link.run('Transfer', uid, 'FromAccount', from, 0);
    link.run('Transfer', uid, 'ToAccount', accs[(accs.indexOf(from) + 1) % accs.length]!, 0);
  }
  db.exec('COMMIT');
  // физические удаления и правки — появляются свободные страницы и переразбиение страниц
  db.exec(`DELETE FROM "transaction" WHERE rowid % 7 = 3`);
  db.exec(`DELETE FROM sync_link WHERE entityType = 'Transaction' AND entityUid NOT IN (SELECT uid FROM "transaction")`);
  db.exec(`UPDATE "transaction" SET comment = comment || ' ' || comment || ' правка' WHERE rowid % 11 = 5`);
  db.exec(`
    INSERT INTO account_balance
    SELECT a.uid,
      COALESCE((SELECT SUM(CASE t.type WHEN 'Income' THEN t.amountInDefaultCurrency ELSE -t.amountInDefaultCurrency END)
                FROM "transaction" t JOIN sync_link l ON l.entityType='Transaction' AND l.entityUid=t.uid AND l.otherType='Account' AND l.isRemoved=0
                WHERE l.otherUid=a.uid AND t.isRemoved=0), 0)
    - COALESCE((SELECT SUM(tr.fromAmount) FROM transfer tr JOIN sync_link l ON l.entityType='Transfer' AND l.entityUid=tr.uid AND l.otherType='FromAccount' AND l.isRemoved=0
                WHERE l.otherUid=a.uid AND tr.isRemoved=0), 0)
    + COALESCE((SELECT SUM(COALESCE(tr.toAmount, tr.fromAmount)) FROM transfer tr JOIN sync_link l ON l.entityType='Transfer' AND l.entityUid=tr.uid AND l.otherType='ToAccount' AND l.isRemoved=0
                WHERE l.otherUid=a.uid AND tr.isRemoved=0), 0)
    FROM account a`);
  const balances = Object.fromEntries((db.prepare('SELECT uid, value FROM account_balance').all() as { uid: string; value: number }[]).map((b) => [b.uid, b.value]));
  db.close();
  return { path, balances };
}

const VARIANTS: Variant[] = [
  { name: 'android-4k', pageSize: 4096, autoVacuum: 0, tx: 6000, seed: 11 },
  { name: 'android-4k-autovacuum-full', pageSize: 4096, autoVacuum: 1, tx: 3000, seed: 22 },
  { name: 'android-1k-incremental', pageSize: 1024, autoVacuum: 2, tx: 2000, seed: 33 },
];

describe.skipIf(!sqliteMod)('SQLite-ридер: стресс на «андроидной» базе против настоящего SQLite', () => {
  for (const v of VARIANTS) {
    it(`${v.name}: все таблицы построчно совпадают`, () => {
      const { path } = build(v);
      const ref = new DatabaseSync(path, { readOnly: true });
      const mine = openSqlite(new Uint8Array(readFileSync(path)));
      const tables = (ref.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((t) => t.name);
      expect([...mine.tableNames()].sort()).toEqual(tables);
      for (const t of tables) {
        const expected = ref.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Record<string, unknown>[];
        const got = mine.readObjects(t);
        expect(got.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) {
          const e = expected[i]!;
          const g = got[i]!;
          for (const k of Object.keys(e)) {
            const ev = e[k] instanceof Uint8Array ? [...(e[k] as Uint8Array)] : e[k];
            const gv = g[k] instanceof Uint8Array ? [...(g[k] as Uint8Array)] : g[k];
            if (ev !== gv && JSON.stringify(ev) !== JSON.stringify(gv)) {
              throw new Error(`${v.name}.${t} строка ${i} колонка ${k}: ожидалось ${JSON.stringify(ev)?.slice(0, 80)}, получено ${JSON.stringify(gv)?.slice(0, 80)}`);
            }
          }
        }
      }
      ref.close();
    });

    it(`${v.name}: импорт как .mmbackup сходится с account_balance до тиына`, () => {
      const { path, balances } = build({ ...v, name: v.name + '-imp' });
      const file = concat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), writeZip([{ name: 'MyFinance.db', data: new Uint8Array(readFileSync(path)) }]));
      const data = importMmbackup(file);
      const rep = reconcileAccounts(data);
      expect(rep.accounts.filter((a) => a.status !== 'ok')).toEqual([]);
      for (const a of rep.accounts) expect(a.computed).toBe(balances[a.accountId]);
    });
  }
});
