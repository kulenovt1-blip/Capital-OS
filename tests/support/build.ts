/** Конструкторы маленьких наборов данных для модульных тестов. */
import { tenge, tiyn, type Money } from '../../engine/money';
import type { Account, Category, ImportedData, Operation, Tag } from '../../engine/types';

export function acc(id: string, title = id, extra: Partial<Account> = {}): Account {
  return { id, title, currency: 'KZT', ignoreInBalance: false, archived: false, removed: false, ...extra };
}

export function cat(id: string, title: string, type: Category['type'] = 'expense', extra: Partial<Category> = {}): Category {
  return { id, title, label: title || `icon:${id}`, type, icon: '', removed: false, ...extra };
}

let seq = 0;
export function inc(date: string, accountId: string, amountT: number, categoryId: string | null, tagIds: string[] = [], comment = ''): Operation {
  return { kind: 'income', id: `op-${String(++seq).padStart(5, '0')}`, date, amount: tenge(amountT), accountId, categoryId, tagIds, comment };
}
export function exp(date: string, accountId: string, amountT: number, categoryId: string | null, tagIds: string[] = [], comment = ''): Operation {
  return { kind: 'expense', id: `op-${String(++seq).padStart(5, '0')}`, date, amount: tenge(amountT), accountId, categoryId, tagIds, comment };
}
export function trf(date: string, from: string, to: string, amountT: number, toAmountT = amountT): Operation {
  return { kind: 'transfer', id: `op-${String(++seq).padStart(5, '0')}`, date, fromAccountId: from, toAccountId: to, fromAmount: tenge(amountT), toAmount: tenge(toAmountT), comment: '' };
}

export function dataset(opts: { accounts: Account[]; categories?: Category[]; tags?: Tag[]; operations: Operation[]; reported?: Record<string, Money> }): ImportedData {
  const ops = [...opts.operations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return {
    accounts: opts.accounts,
    categories: opts.categories ?? [],
    tags: opts.tags ?? [],
    operations: ops,
    reportedBalances: opts.reported ?? {},
    warnings: [],
    meta: { entryName: 'test', prefixLength: 0, dbBytes: 0, firstDate: ops[0]?.date ?? null, lastDate: ops[ops.length - 1]?.date ?? null },
  };
}

export const T = tenge;
export const t = tiyn;
