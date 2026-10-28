import type { Money } from './money';
import type { IsoDate } from './date';

/** Нормализованные данные импорта: всё, что движок знает о MoneyManager. */

export interface Account {
  id: string;
  title: string;
  currency: string;
  ignoreInBalance: boolean;
  archived: boolean;
  removed: boolean;
}

export type CategoryType = 'income' | 'expense' | 'unknown';

export interface Category {
  id: string;
  /** Название из MoneyManager; может быть пустым у системных категорий. */
  title: string;
  /** Что показывать: название или производное от иконки. */
  label: string;
  type: CategoryType;
  icon: string;
  removed: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

export interface TxOperation {
  kind: 'income' | 'expense';
  id: string;
  date: IsoDate;
  /** Всегда положительная величина; знак задаёт kind. */
  amount: Money;
  accountId: string;
  categoryId: string | null;
  tagIds: string[];
  comment: string;
}

export interface TransferOperation {
  kind: 'transfer';
  id: string;
  date: IsoDate;
  fromAccountId: string;
  toAccountId: string;
  fromAmount: Money;
  toAmount: Money;
  comment: string;
}

export type Operation = TxOperation | TransferOperation;

export interface ImportWarning {
  code: string;
  text: string;
  refs?: Record<string, string>;
}

export interface ImportedData {
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  /** Отсортированы по дате, затем по id. Удалённые исключены. */
  operations: Operation[];
  /** account_balance: эталон для сверки. */
  reportedBalances: Record<string, Money>;
  warnings: ImportWarning[];
  meta: { entryName: string; prefixLength: number; dbBytes: number; firstDate: IsoDate | null; lastDate: IsoDate | null };
}
