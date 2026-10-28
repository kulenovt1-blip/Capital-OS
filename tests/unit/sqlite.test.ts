import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { openSqlite, parseCreateTable, type SqlValue } from '../../engine/import/sqlite';
import { fixtureBytes, fixtureJson } from '../support/fixtures';

const load = (name: string) => fixtureBytes(`sqlite/${name}`);
const expected = (name: string) => fixtureJson(`sqlite/${name}`);

/** Тот же канонический вид, что пишет scripts/make-fixtures.ts. */
function canon(v: SqlValue): unknown {
  if (v instanceof Uint8Array) return { $blob: Buffer.from(v).toString('hex') };
  if (typeof v === 'bigint') return { $bigint: v.toString() };
  return v;
}

describe('SQLite-ридер против настоящего SQLite', () => {
  it('basic.db: типы, INTEGER PRIMARY KEY, ALTER TABLE ADD COLUMN, кавычки в именах', () => {
    const db = openSqlite(load('basic.db'));
    const exp = expected('basic.expected.json');
    for (const table of Object.keys(exp)) {
      const t = db.table(table);
      expect(t.columns).toEqual(exp[table].columns);
      expect(t.rows.map((r) => r.map(canon))).toEqual(exp[table].rows);
    }
    expect(db.tableNames()).toContain('transaction');
    expect(db.hasTable('nope')).toBe(false);
  });

  it('readObjects отдаёт строки как объекты', () => {
    const db = openSqlite(load('basic.db'));
    const acc = db.readObjects('account');
    expect(acc[2]).toEqual({ uid: 'a3', title: 'Депозит', isRemoved: 1, note: null, neg: 7 });
    expect(acc[0]).toEqual({ uid: 'a1', title: 'Kaspi Gold', isRemoved: 0, note: 'нет', neg: -5 });
  });

  for (const name of ['smallpage', 'page64k']) {
    it(`${name}.db: многоуровневое дерево и overflow-страницы`, () => {
      const db = openSqlite(load(`${name}.db`));
      const exp = expected(`${name}.expected.json`).t;
      const t = db.table('t');
      expect(t.columns).toEqual(exp.columns);
      expect(t.rows.length).toBe(exp.rowCount);
      expect(t.rows.slice(0, 3).map((r) => [r[0], r[2]])).toEqual(exp.head);
      const json = JSON.stringify({ columns: t.columns, rows: t.rows.map((r) => r.map(canon)) });
      expect(createHash('sha256').update(json).digest('hex')).toBe(exp.sha256);
    });
  }

  it('понятные ошибки', () => {
    expect(() => openSqlite(new TextEncoder().encode('not sqlite at all, definitely not'))).toThrow(/SQLite/);
    const db = openSqlite(load('basic.db'));
    expect(() => db.table('missing')).toThrow(/missing/);
  });
});

describe('parseCreateTable', () => {
  it('разбирает колонки, кавычки, ограничения и DEFAULT', () => {
    const t = parseCreateTable(
      `CREATE TABLE IF NOT EXISTS "my table" ( [id] INTEGER PRIMARY KEY AUTOINCREMENT, \`a,b\` TEXT DEFAULT 'x,y', c REAL DEFAULT -1.5, d DEFAULT NULL, e INTEGER DEFAULT (1+2), CONSTRAINT pk UNIQUE (c), FOREIGN KEY (d) REFERENCES z(id) )`,
    );
    expect(t.columns.map((c) => c.name)).toEqual(['id', 'a,b', 'c', 'd', 'e']);
    expect(t.rowidAlias).toBe(0);
    expect(t.columns.map((c) => c.default)).toEqual([null, 'x,y', -1.5, null, null]);
    expect(t.withoutRowid).toBe(false);
  });

  it('PRIMARY KEY на уровне таблицы с одной INTEGER-колонкой — алиас rowid', () => {
    expect(parseCreateTable('CREATE TABLE t (k INTEGER, v TEXT, PRIMARY KEY(k))').rowidAlias).toBe(0);
    expect(parseCreateTable('CREATE TABLE t (k INT, v TEXT, PRIMARY KEY(k))').rowidAlias).toBe(-1);
    expect(parseCreateTable('CREATE TABLE t (k INTEGER, v TEXT, PRIMARY KEY(k, v))').rowidAlias).toBe(-1);
    expect(parseCreateTable('CREATE TABLE t (uid TEXT PRIMARY KEY)').rowidAlias).toBe(-1);
  });

  it('распознаёт WITHOUT ROWID', () => {
    expect(parseCreateTable('CREATE TABLE t (k TEXT PRIMARY KEY) WITHOUT ROWID').withoutRowid).toBe(true);
  });
});
