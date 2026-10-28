/**
 * Генерация синтетических фикстур (запуск: `bun scripts/make-fixtures.ts`).
 * Использует настоящий SQLite (bun:sqlite) — так движок проверяется против независимой реализации.
 * Результат коммитится в tests/fixtures; реальные данные пользователя сюда не попадают никогда.
 */
// @ts-nocheck — скрипт для Bun, типы bun:sqlite в проекте не подключены
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeZip, concat } from '../tests/support/zip-writer';

const ROOT = join(import.meta.dir, '..', 'tests', 'fixtures');
const SQL_DIR = join(ROOT, 'sqlite');
mkdirSync(SQL_DIR, { recursive: true });

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

function freshDb(path: string): Database {
  if (existsSync(path)) rmSync(path);
  return new Database(path, { create: true });
}

function dumpTables(db: Database, tables: string[]) {
  const out: Record<string, { columns: string[]; rows: unknown[][] }> = {};
  for (const t of tables) {
    const stmt = db.query(`SELECT * FROM "${t}" ORDER BY rowid`);
    const columns = stmt.columnNames;
    const rows = stmt.values().map((r) =>
      r.map((v) => (v instanceof Uint8Array ? { $blob: Buffer.from(v).toString('hex') } : typeof v === 'bigint' ? { $bigint: v.toString() } : v)),
    );
    out[t] = { columns, rows };
  }
  return out;
}

// ---------- 1. Фикстуры для SQLite-ридера ----------

function makeBasic() {
  const path = join(SQL_DIR, 'basic.db');
  const db = freshDb(path);
  db.run(`CREATE TABLE "transaction" (
    id INTEGER PRIMARY KEY,
    uid TEXT NOT NULL,
    "type" TEXT,
    amount INTEGER DEFAULT 0,
    rate REAL,
    note TEXT,
    payload BLOB,
    CONSTRAINT uq UNIQUE (uid)
  )`);
  const ins = db.prepare(`INSERT INTO "transaction"(id, uid, type, amount, rate, note, payload) VALUES (?,?,?,?,?,?,?)`);
  const ints = [0, 1, -1, 127, 128, -129, 32767, -32768, 8388607, -8388608, 2147483647, -2147483648, 2 ** 40, -(2 ** 41), 2 ** 52, -(2 ** 52) + 3, 9007199254740991];
  ints.forEach((n, i) => ins.run(i + 1, `u-${i}`, i % 2 ? 'Income' : 'Expense', n, i === 0 ? null : i / 4 - 2.5, i % 3 ? `заметка ${i} 🙂` : null, i % 4 === 0 ? new Uint8Array([i, 255, 0, 7]) : null));
  ins.run(100, 'u-float', 'Expense', 0, 1e300, '', new Uint8Array(0));
  // таблица с колонкой, добавленной позже через ALTER TABLE
  db.run(`CREATE TABLE [account] (\`uid\` TEXT, title TEXT)`);
  db.run(`INSERT INTO account VALUES ('a1','Kaspi Gold'),('a2','Наличные')`);
  db.run(`ALTER TABLE account ADD COLUMN isRemoved INTEGER NOT NULL DEFAULT 0`);
  db.run(`ALTER TABLE account ADD COLUMN note TEXT DEFAULT 'нет'`);
  db.run(`ALTER TABLE account ADD COLUMN neg INTEGER DEFAULT -5`);
  db.run(`INSERT INTO account VALUES ('a3','Депозит',1,NULL,7)`);
  // таблица с составным первичным ключом на уровне таблицы
  db.run(`CREATE TABLE sync_link (entityType TEXT, entityUid TEXT, otherType TEXT, otherUid TEXT, isRemoved INTEGER, PRIMARY KEY (entityUid, otherUid))`);
  db.run(`INSERT INTO sync_link VALUES ('Transaction','u-1','Account','a1',0)`);
  db.run(`CREATE TABLE pk_tbl (k INTEGER, v TEXT, PRIMARY KEY(k))`);
  db.run(`INSERT INTO pk_tbl VALUES (10,'десять'),(20,'двадцать')`);
  db.run(`CREATE INDEX idx_note ON "transaction"(note)`);
  const expected = dumpTables(db, ['transaction', 'account', 'sync_link', 'pk_tbl']);
  db.close();
  writeFileSync(join(SQL_DIR, 'basic.expected.json'), JSON.stringify(expected, null, 1));
}

function makeBig(name: string, pageSize: number, rows: number, textLen: number) {
  const path = join(SQL_DIR, `${name}.db`);
  const db = freshDb(path);
  db.run(`PRAGMA page_size = ${pageSize}`);
  db.run(`CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b INTEGER, c BLOB)`);
  const r = prng(pageSize + rows);
  const ins = db.prepare('INSERT INTO t(a, b, c) VALUES (?,?,?)');
  db.transaction(() => {
    for (let i = 0; i < rows; i++) {
      const len = Math.floor(r() * textLen);
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode(0x430 + Math.floor(r() * 32));
      const blobLen = i % 50 === 0 ? Math.floor(r() * pageSize * 3) : 0;
      ins.run(s, Math.floor(r() * 2 ** 40) - 2 ** 39, blobLen ? new Uint8Array(blobLen).map(() => Math.floor(r() * 256)) : null);
    }
  })();
  db.run('DELETE FROM t WHERE id % 97 = 0'); // дыры и свободные страницы
  const full = dumpTables(db, ['t']);
  db.close();
  // большие эталоны не храним целиком: число строк, первые строки и SHA-256 канонического JSON
  const t = full.t;
  const sha256 = new Bun.CryptoHasher('sha256').update(JSON.stringify(t)).digest('hex');
  writeFileSync(join(SQL_DIR, `${name}.expected.json`), JSON.stringify({ t: { columns: t.columns, rowCount: t.rows.length, head: t.rows.slice(0, 3).map((r) => [r[0], r[2]]), sha256 } }));
}

// ---------- 2. Синтетический бэкап MoneyManager ----------

interface Tx { uid: string; type: 'Income' | 'Expense'; amount: number; date: string; comment: string; isRemoved: number; account: string; category?: string; tags?: string[] }
interface Tr { uid: string; fromAmount: number; toAmount: number | null; date: string; comment: string; isRemoved: number; from: string; to: string }

function buildSynthetic() {
  const r = prng(20261028);
  const accounts = [
    { uid: 'acc-kaspi', title: 'Kaspi Gold', currencyCode: 'KZT', ignoreInBalance: 0, isArchived: 0, isRemoved: 0 },
    { uid: 'acc-cash', title: 'Наличные', currencyCode: 'KZT', ignoreInBalance: 0, isArchived: 0, isRemoved: 0 },
    { uid: 'acc-halyk', title: 'Halyk', currencyCode: 'KZT', ignoreInBalance: 0, isArchived: 1, isRemoved: 0 },
    { uid: 'acc-tech', title: 'Технический', currencyCode: 'KZT', ignoreInBalance: 1, isArchived: 0, isRemoved: 0 },
    { uid: 'acc-old', title: 'Старая карта', currencyCode: 'KZT', ignoreInBalance: 0, isArchived: 0, isRemoved: 1 },
  ];
  const cats = [
    ['cat-food', 'Продукты', 'Expense', 'ic_food'],
    ['cat-transport', 'Транспорт', 'Expense', 'ic_bus'],
    ['cat-phone', 'Связь', 'Expense', 'ic_phone'],
    ['cat-fun', 'Развлечения', 'Expense', 'ic_fun'],
    ['cat-family', 'Семья', 'Expense', 'ic_family'],
    ['cat-savings-out', 'Накопительный счёт', 'Expense', 'ic_piggy'],
    ['cat-lent', 'Долг', 'Expense', 'ic_debt'],
    ['cat-repay', 'Возвращаю долг', 'Expense', 'ic_debt'],
    ['cat-installment', 'Рассрочка', 'Expense', 'ic_card'],
    ['cat-exchange', 'Размен', 'Expense', 'ic_exchange'],
    ['cat-fee', '', 'Expense', 'ic_fee'],
    ['cat-salary', 'Зарплата', 'Income', 'ic_salary'],
    ['cat-stipend', 'Стипендия', 'Income', 'ic_edu'],
    ['cat-savings-in', 'Накопление', 'Income', 'ic_piggy'],
    ['cat-lent-back', 'Возвращают долг', 'Income', 'ic_debt'],
    ['cat-borrow', 'Беру в долг', 'Income', 'ic_debt'],
    ['cat-bonus', 'Бонус', 'Income', 'ic_gift'],
    ['cat-old', 'Старое', 'Expense', 'ic_old'],
  ];
  const tags = [
    ['tag-mom', 'мама'],
    ['tag-phone', 'телефон'],
    ['tag-friend', 'друг'],
  ];
  const tx: Tx[] = [];
  const tr: Tr[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${String(++n).padStart(4, '0')}`;
  const add = (t: Omit<Tx, 'uid' | 'isRemoved' | 'comment'> & { comment?: string; isRemoved?: number }) =>
    tx.push({ uid: id('tx'), comment: '', isRemoved: 0, ...t });
  const money = (minT: number, maxT: number) => Math.round((minT + r() * (maxT - minT)) * 100);

  // начальные остатки (без категории)
  add({ type: 'Income', amount: 15000000, date: '2026-03-01', account: 'acc-kaspi', comment: 'Начальный остаток' });
  add({ type: 'Income', amount: 2000000, date: '2026-03-01', account: 'acc-cash', comment: 'Начальный остаток' });

  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  for (const m of months) {
    const working = m >= '2026-06';
    add({ type: 'Income', amount: 3800000, date: `${m}-10`, account: 'acc-kaspi', category: 'cat-stipend' });
    if (working) {
      add({ type: 'Income', amount: money(170000, 190000), date: `${m}-05`, account: 'acc-kaspi', category: 'cat-salary' });
      add({ type: 'Income', amount: money(80000, 95000), date: `${m}-20`, account: 'acc-kaspi', category: 'cat-salary' });
    }
    for (let d = 2; d <= 27; d += 2 + Math.floor(r() * 3)) {
      add({ type: 'Expense', amount: money(1500, 12000), date: `${m}-${String(d).padStart(2, '0')}`, account: r() < 0.8 ? 'acc-kaspi' : 'acc-cash', category: 'cat-food' });
    }
    add({ type: 'Expense', amount: money(3000, 6000), date: `${m}-03`, account: 'acc-kaspi', category: 'cat-transport' });
    add({ type: 'Expense', amount: 399000, date: `${m}-07`, account: 'acc-kaspi', category: 'cat-phone' });
    add({ type: 'Expense', amount: 3028500, date: `${m}-05`, account: 'acc-kaspi', category: 'cat-installment', tags: ['tag-phone'], comment: 'Рассрочка телефон' });
    add({ type: 'Expense', amount: 1500000, date: `${m}-15`, account: 'acc-kaspi', category: 'cat-installment', tags: ['tag-mom'], comment: 'Рассрочка мамы' });
    if (r() < 0.6) add({ type: 'Expense', amount: money(2000, 15000), date: `${m}-25`, account: 'acc-cash', category: 'cat-fun' });
    add({ type: 'Expense', amount: money(5000, 20000), date: `${m}-12`, account: 'acc-kaspi', category: 'cat-family', tags: ['tag-mom'] });
    add({ type: 'Income', amount: money(300, 1500), date: `${m}-28`, account: 'acc-kaspi', category: 'cat-bonus' });
    if (working) add({ type: 'Expense', amount: 5000000, date: `${m}-21`, account: 'acc-kaspi', category: 'cat-savings-out', comment: 'На депозит' });
    // снятие наличных: toAmount = NULL
    tr.push({ uid: id('tr'), fromAmount: 2500000, toAmount: null, date: `${m}-11`, comment: 'Снятие', isRemoved: 0, from: 'acc-kaspi', to: 'acc-cash' });
  }
  // разовые события
  add({ type: 'Income', amount: 2000000, date: '2026-09-14', account: 'acc-kaspi', category: 'cat-savings-in', comment: 'Снял с депозита' });
  add({ type: 'Expense', amount: 1000000, date: '2026-04-02', account: 'acc-kaspi', category: 'cat-lent', tags: ['tag-friend'], comment: 'Дал Арману' });
  add({ type: 'Income', amount: 1000000, date: '2026-05-02', account: 'acc-kaspi', category: 'cat-lent-back', tags: ['tag-friend'], comment: 'Арман вернул' });
  add({ type: 'Income', amount: 500000, date: '2026-04-20', account: 'acc-cash', category: 'cat-borrow', comment: 'Занял у брата' });
  add({ type: 'Expense', amount: 300000, date: '2026-06-06', account: 'acc-cash', category: 'cat-repay', comment: 'Вернул брату часть' });
  add({ type: 'Expense', amount: 123456, date: '2026-08-31', account: 'acc-cash', comment: 'Корректировка баланса' }); // без категории
  add({ type: 'Expense', amount: 10000, date: '2026-08-31', account: 'acc-cash', category: 'cat-exchange', comment: 'Размен' });
  add({ type: 'Expense', amount: 25000, date: '2026-07-19', account: 'acc-kaspi', category: 'cat-fee', comment: 'Комиссия' });
  add({ type: 'Expense', amount: 99900, date: '2026-03-09', account: 'acc-kaspi', category: 'cat-old', comment: 'Категория потом удалена' });
  // технический счёт
  add({ type: 'Income', amount: 777700, date: '2026-05-01', account: 'acc-tech', comment: 'Тех. остаток' });
  // перевод с комиссией: 5 000 ушло, 4 950 пришло; потом всё вернули — Halyk в ноль
  tr.push({ uid: id('tr'), fromAmount: 500000, toAmount: 495000, date: '2026-07-01', comment: 'На Halyk', isRemoved: 0, from: 'acc-kaspi', to: 'acc-halyk' });
  tr.push({ uid: id('tr'), fromAmount: 495000, toAmount: 495000, date: '2026-07-02', comment: 'Обратно', isRemoved: 0, from: 'acc-halyk', to: 'acc-kaspi' });
  tr.push({ uid: id('tr'), fromAmount: 300000, toAmount: 300000, date: '2026-09-01', comment: 'Внёс наличные', isRemoved: 0, from: 'acc-cash', to: 'acc-kaspi' });
  // удалённые сущности, которые должны игнорироваться
  add({ type: 'Income', amount: 999999900, date: '2026-06-01', account: 'acc-kaspi', category: 'cat-salary', isRemoved: 1, comment: 'удалено' });
  add({ type: 'Expense', amount: 55555500, date: '2026-06-02', account: 'acc-cash', category: 'cat-food', isRemoved: 1 });
  tr.push({ uid: id('tr'), fromAmount: 77700000, toAmount: null, date: '2026-06-03', comment: 'удалён', isRemoved: 1, from: 'acc-kaspi', to: 'acc-cash' });

  return { accounts, cats, tags, tx, tr };
}

function writeMoneyManagerDb(path: string, data: ReturnType<typeof buildSynthetic>, breakBalance = false) {
  const db = freshDb(path);
  db.run(`CREATE TABLE account (uid TEXT PRIMARY KEY, title TEXT, currencyCode TEXT, ignoreInBalance INTEGER, isArchived INTEGER, isRemoved INTEGER, color INTEGER)`);
  db.run(`CREATE TABLE account_balance (uid TEXT PRIMARY KEY, value INTEGER)`);
  db.run(`CREATE TABLE category (uid TEXT PRIMARY KEY, title TEXT, type TEXT, icon TEXT, isRemoved INTEGER)`);
  db.run(`CREATE TABLE tag (uid TEXT PRIMARY KEY, name TEXT)`);
  db.run(`CREATE TABLE "transaction" (uid TEXT PRIMARY KEY, type TEXT, amount INTEGER, amountInDefaultCurrency INTEGER, date TEXT, comment TEXT, isRemoved INTEGER, createdAt INTEGER)`);
  db.run(`CREATE TABLE transfer (uid TEXT PRIMARY KEY, fromAmount INTEGER, toAmount INTEGER, date TEXT, comment TEXT, isRemoved INTEGER)`);
  db.run(`CREATE TABLE sync_link (id INTEGER PRIMARY KEY AUTOINCREMENT, entityType TEXT, entityUid TEXT, otherType TEXT, otherUid TEXT, isRemoved INTEGER)`);
  db.run(`CREATE TABLE android_metadata (locale TEXT)`);
  db.run(`INSERT INTO android_metadata VALUES ('ru_RU')`);
  db.transaction(() => {
    for (const a of data.accounts) db.run('INSERT INTO account VALUES (?,?,?,?,?,?,?)', [a.uid, a.title, a.currencyCode, a.ignoreInBalance, a.isArchived, a.isRemoved, 0]);
    for (const [uid, title, type, icon] of data.cats) db.run('INSERT INTO category VALUES (?,?,?,?,?)', [uid, title, type, icon, uid === 'cat-old' ? 1 : 0]);
    for (const [uid, name] of data.tags) db.run('INSERT INTO tag VALUES (?,?)', [uid, name]);
    const link = (et: string, eu: string, ot: string, ou: string, rm = 0) => db.run('INSERT INTO sync_link(entityType, entityUid, otherType, otherUid, isRemoved) VALUES (?,?,?,?,?)', [et, eu, ot, ou, rm]);
    for (const t of data.tx) {
      db.run('INSERT INTO "transaction" VALUES (?,?,?,?,?,?,?,?)', [t.uid, t.type, t.amount, t.amount, t.date, t.comment, t.isRemoved, 1700000000]);
      link('Transaction', t.uid, 'Account', t.account);
      if (t.category) link('Transaction', t.uid, 'Category', t.category);
      for (const tg of t.tags ?? []) link('Transaction', t.uid, 'Tag', tg);
    }
    // удалённая связь: тег, который был снят с операции
    const someFood = data.tx.find((t) => t.category === 'cat-food' && !t.isRemoved)!;
    link('Transaction', someFood.uid, 'Tag', 'tag-mom', 1);
    for (const t of data.tr) {
      db.run('INSERT INTO transfer VALUES (?,?,?,?,?,?)', [t.uid, t.fromAmount, t.toAmount, t.date, t.comment, t.isRemoved]);
      link('Transfer', t.uid, 'FromAccount', t.from);
      link('Transfer', t.uid, 'ToAccount', t.to);
    }
  })();
  // Эталонные балансы: независимый расчёт средствами SQL (не кодом движка)
  const balances = db
    .query(
      `SELECT a.uid AS uid,
        COALESCE((SELECT SUM(CASE t.type WHEN 'Income' THEN t.amountInDefaultCurrency ELSE -t.amountInDefaultCurrency END)
                  FROM "transaction" t JOIN sync_link l ON l.entityType='Transaction' AND l.entityUid=t.uid AND l.otherType='Account' AND l.isRemoved=0
                  WHERE l.otherUid=a.uid AND t.isRemoved=0), 0)
      - COALESCE((SELECT SUM(tr.fromAmount) FROM transfer tr JOIN sync_link l ON l.entityType='Transfer' AND l.entityUid=tr.uid AND l.otherType='FromAccount' AND l.isRemoved=0
                  WHERE l.otherUid=a.uid AND tr.isRemoved=0), 0)
      + COALESCE((SELECT SUM(COALESCE(tr.toAmount, tr.fromAmount)) FROM transfer tr JOIN sync_link l ON l.entityType='Transfer' AND l.entityUid=tr.uid AND l.otherType='ToAccount' AND l.isRemoved=0
                  WHERE l.otherUid=a.uid AND tr.isRemoved=0), 0) AS value
      FROM account a WHERE a.isRemoved = 0`,
    )
    .all() as { uid: string; value: number }[];
  for (const b of balances) {
    const v = breakBalance && b.uid === 'acc-kaspi' ? b.value + 1 : b.value;
    db.run('INSERT INTO account_balance VALUES (?,?)', [b.uid, v]);
  }
  db.close();
  return Object.fromEntries(balances.map((b) => [b.uid, breakBalance && b.uid === 'acc-kaspi' ? b.value + 1 : b.value]));
}

function packMmbackup(dbPath: string, outPath: string) {
  const prefix = new Uint8Array([0x4d, 0x4d, 0x42, 0x4b, 0x00, 0x02, 0x00, 0x01]); // 8 байт, как в реальном файле
  const zip = writeZip([
    { name: 'MyFinance.db', data: new Uint8Array(readFileSync(dbPath)) },
    { name: 'settings.json', data: new TextEncoder().encode('{"currency":"KZT"}'), method: 0 },
  ]);
  writeFileSync(outPath, concat(prefix, zip));
}

makeBasic();
makeBig('smallpage', 512, 1500, 200);
makeBig('page64k', 65536, 8, 70000);

const data = buildSynthetic();
const tmpDb = join(ROOT, 'tmp-MyFinance.db');
const balances = writeMoneyManagerDb(tmpDb, data);
packMmbackup(tmpDb, join(ROOT, 'synthetic.mmbackup'));
const activeTx = data.tx.filter((t) => !t.isRemoved);
writeFileSync(
  join(ROOT, 'synthetic.expected.json'),
  JSON.stringify(
    {
      balances,
      counts: { transactions: activeTx.length, transfers: data.tr.filter((t) => !t.isRemoved).length },
      byCategory: Object.fromEntries(data.cats.map(([uid]) => [uid, activeTx.filter((t) => t.category === uid).length])),
      uncategorized: activeTx.filter((t) => !t.category).length,
    },
    null,
    1,
  ),
);
const brokenBalances = writeMoneyManagerDb(tmpDb, data, true);
packMmbackup(tmpDb, join(ROOT, 'broken-balance.mmbackup'));
rmSync(tmpDb);
console.log('fixtures ok', balances, brokenBalances['acc-kaspi']);
