import { describe, it, expect } from 'vitest';
import { importMmbackup, extractDatabase, readMoneyManager } from '../../engine/import/mmbackup';
import { reconcileAccounts, computeBalances } from '../../engine/ledger';
import { openSqlite } from '../../engine/import/sqlite';
import { fixtureBytes, fixtureJson } from '../support/fixtures';
import { writeZip, concat } from '../support/zip-writer';

const expected = fixtureJson<{
  balances: Record<string, number>;
  counts: { transactions: number; transfers: number };
  byCategory: Record<string, number>;
  uncategorized: number;
}>('synthetic.expected.json');

describe('импорт .mmbackup (синтетический бэкап)', () => {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));

  it('находит ZIP после 8-байтового префикса и берёт MyFinance.db', () => {
    expect(data.meta.prefixLength).toBe(8);
    expect(data.meta.entryName).toBe('MyFinance.db');
  });

  it('загружает счета, категории, теги', () => {
    expect(data.accounts.filter((a) => !a.removed).map((a) => a.id).sort()).toEqual(['acc-cash', 'acc-halyk', 'acc-kaspi', 'acc-tech']);
    expect(data.accounts.find((a) => a.id === 'acc-old')!.removed).toBe(true);
    expect(data.accounts.find((a) => a.id === 'acc-tech')!.ignoreInBalance).toBe(true);
    expect(data.accounts.find((a) => a.id === 'acc-halyk')!.archived).toBe(true);
    expect(data.tags.map((t) => t.name).sort()).toEqual(['друг', 'мама', 'телефон']);
  });

  it('системной категории без названия даёт имя из иконки', () => {
    const fee = data.categories.find((c) => c.id === 'cat-fee')!;
    expect(fee.title).toBe('');
    expect(fee.label).toBe('icon:ic_fee');
    expect(data.categories.find((c) => c.id === 'cat-old')!.removed).toBe(true);
  });

  it('исключает удалённые операции и переводы', () => {
    const tx = data.operations.filter((o) => o.kind !== 'transfer');
    const tr = data.operations.filter((o) => o.kind === 'transfer');
    expect(tx.length).toBe(expected.counts.transactions);
    expect(tr.length).toBe(expected.counts.transfers);
    for (const [cat, n] of Object.entries(expected.byCategory)) {
      expect(tx.filter((o) => o.kind !== 'transfer' && o.categoryId === cat).length).toBe(n);
    }
    expect(tx.filter((o) => o.kind !== 'transfer' && o.categoryId === null).length).toBe(expected.uncategorized);
  });

  it('перевод с toAmount = NULL получает toAmount = fromAmount', () => {
    const t = data.operations.find((o) => o.kind === 'transfer' && o.comment === 'Снятие');
    expect(t && t.kind === 'transfer' && t.toAmount === t.fromAmount).toBe(true);
    const fee = data.operations.find((o) => o.kind === 'transfer' && o.comment === 'На Halyk');
    expect(fee && fee.kind === 'transfer' && [fee.fromAmount, fee.toAmount]).toEqual([500000, 495000]);
  });

  it('удалённая связь (sync_link.isRemoved = 1) не применяется', () => {
    const momTagged = data.operations.filter((o) => o.kind !== 'transfer' && o.tagIds.includes('tag-mom'));
    expect(momTagged.every((o) => o.kind !== 'transfer' && o.categoryId !== 'cat-food')).toBe(true);
  });

  it('операции отсортированы по дате и id', () => {
    const keys = data.operations.map((o) => `${o.date}|${o.id}`);
    expect([...keys].sort()).toEqual(keys);
  });

  it('сверка сходится с account_balance до тиына по каждому счёту', () => {
    const rep = reconcileAccounts(data);
    expect(rep.ok).toBe(true);
    for (const [acc, bal] of Object.entries(expected.balances)) {
      const row = rep.accounts.find((a) => a.accountId === acc)!;
      expect(row.computed).toBe(bal);
      expect(row.reported).toBe(bal);
      expect(row.diff).toBe(0);
      expect(row.status).toBe('ok');
    }
    expect(computeBalances(data.operations).get('acc-kaspi')).toBe(expected.balances['acc-kaspi']);
  });
});

describe('импорт: расхождение и ошибки', () => {
  it('расхождение в 1 тиын ловится и показывается по счёту', () => {
    const data = importMmbackup(fixtureBytes('broken-balance.mmbackup'));
    const rep = reconcileAccounts(data);
    expect(rep.ok).toBe(false);
    const kaspi = rep.accounts.find((a) => a.accountId === 'acc-kaspi')!;
    expect(kaspi.status).toBe('mismatch');
    expect(kaspi.diff).toBe(-1);
    expect(rep.accounts.filter((a) => a.status !== 'ok').length).toBe(1);
    expect(rep.explanation.some((s) => s.code === 'reconcile.mismatch' && s.text.includes('Kaspi Gold'))).toBe(true);
  });

  it('файл без ZIP — понятная ошибка', () => {
    expect(() => extractDatabase(new TextEncoder().encode('hello'))).toThrow(/ZIP/);
  });

  it('ZIP без базы — понятная ошибка', () => {
    const z = concat(new Uint8Array(8), writeZip([{ name: 'readme.txt', data: new TextEncoder().encode('x') }]));
    expect(() => extractDatabase(z)).toThrow(/MyFinance\.db/);
  });

  it('если базы называется иначе, но .db один — берёт его', () => {
    const db = fixtureBytes('sqlite/basic.db');
    const z = writeZip([{ name: 'data/Other.db', data: db }]);
    expect(extractDatabase(z).entryName).toBe('data/Other.db');
  });

  it('база без нужных таблиц — ошибка с именем таблицы', () => {
    expect(() => readMoneyManager(openSqlite(fixtureBytes('sqlite/basic.db')), { entryName: 'x', prefixLength: 0, dbBytes: 0 })).toThrow(
      /account_balance|category|transfer|tag/,
    );
  });
});
