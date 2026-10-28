/**
 * Импорт бэкапа MoneyManager (.mmbackup = бинарный префикс + ZIP с MyFinance.db).
 * Все допущения о схеме собраны в MM_SCHEMA — если реальный файл отличается, править здесь.
 */
import { findZipStart, readZip } from './zip';
import { openSqlite, type SqliteDb, type SqlValue } from './sqlite';
import { tiyn, type Money } from '../money';
import { isIsoDate } from '../date';
import type { Account, Category, ImportedData, ImportWarning, Operation, Tag, TxOperation } from '../types';

export const MM_SCHEMA = {
  dbEntry: 'MyFinance.db',
  tables: {
    transaction: 'transaction',
    transfer: 'transfer',
    account: 'account',
    accountBalance: 'account_balance',
    category: 'category',
    tag: 'tag',
    syncLink: 'sync_link',
  },
  /** Значения sync_link.entityType / otherType (BLOCKERS B3). */
  link: {
    transaction: 'Transaction',
    transfer: 'Transfer',
    account: 'Account',
    category: 'Category',
    tag: 'Tag',
    fromAccount: 'FromAccount',
    toAccount: 'ToAccount',
  },
  txType: { income: 'Income', expense: 'Expense' },
  categoryType: { income: 'Income', expense: 'Expense' },
} as const;

/** Название счёта для показа: пустое → «(без названия, начало id)». */
export function accountDisplayTitle(title: string, uid: string): string {
  const t = title.trim();
  return t || `(без названия, ${uid.slice(0, 6)})`;
}

export interface ExtractedDb {
  db: Uint8Array;
  entryName: string;
  prefixLength: number;
}

/** Найти ZIP внутри файла и достать базу. Смещение не зашито — ищется сигнатура PK\x03\x04. */
export function extractDatabase(file: Uint8Array): ExtractedDb {
  const start = findZipStart(file);
  if (start < 0) throw new Error('Файл не похож на бэкап MoneyManager: внутри не найден ZIP-архив');
  const entries = readZip(file.subarray(start));
  const exact = entries.find((e) => e.name === MM_SCHEMA.dbEntry || e.name.endsWith('/' + MM_SCHEMA.dbEntry));
  const dbs = entries.filter((e) => /\.(db|sqlite3?)$/i.test(e.name));
  const entry = exact ?? (dbs.length === 1 ? dbs[0] : undefined);
  if (!entry) {
    throw new Error(`В архиве нет ${MM_SCHEMA.dbEntry}. Файлы в архиве: ${entries.map((e) => e.name).join(', ') || '(пусто)'}`);
  }
  return { db: entry.data(), entryName: entry.name, prefixLength: start };
}

const str = (v: SqlValue | undefined): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));
const flag = (v: SqlValue | undefined): boolean => v !== null && v !== undefined && v !== 0 && v !== '0' && v !== '';

function amount(v: SqlValue | undefined, ctx: string, warnings: ImportWarning[]): Money {
  if (v === null || v === undefined) {
    warnings.push({ code: 'amount.null', text: `${ctx}: сумма пустая, принята 0`, refs: { ctx } });
    return tiyn(0);
  }
  if (typeof v === 'bigint' || typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`${ctx}: сумма «${String(v)}» не целое число тиынов — формат базы отличается от ожидаемого`);
  }
  if (v < 0) {
    warnings.push({ code: 'amount.negative', text: `${ctx}: отрицательная сумма ${v}, взят модуль (знак задаёт тип операции)`, refs: { ctx } });
    return tiyn(-v);
  }
  return tiyn(v);
}

interface Links {
  account: string[];
  category: string[];
  tags: string[];
  from: string[];
  to: string[];
}

function emptyLinks(): Links {
  return { account: [], category: [], tags: [], from: [], to: [] };
}

function requireTables(db: SqliteDb): void {
  const missing = Object.values(MM_SCHEMA.tables).filter((t) => !db.hasTable(t));
  if (missing.length) throw new Error(`В базе нет таблиц: ${missing.join(', ')}. Это точно бэкап MoneyManager?`);
}

/** Прочитать нормализованные данные из уже открытой базы. */
export function readMoneyManager(db: SqliteDb, meta: { entryName: string; prefixLength: number; dbBytes: number }): ImportedData {
  requireTables(db);
  const T = MM_SCHEMA.tables;
  const L = MM_SCHEMA.link;
  const warnings: ImportWarning[] = [];

  const accounts: Account[] = db.readObjects(T.account).map((r) => ({
    id: str(r.uid),
    title: accountDisplayTitle(str(r.title), str(r.uid)),
    currency: str(r.currencyCode) || 'KZT',
    ignoreInBalance: flag(r.ignoreInBalance),
    archived: flag(r.isArchived),
    removed: flag(r.isRemoved),
  }));
  for (const a of accounts) {
    if (!a.removed && a.currency !== 'KZT') {
      warnings.push({ code: 'account.currency', text: `Счёт «${a.title}» в валюте ${a.currency}: мультивалютность не поддерживается, суммы берутся как есть`, refs: { accountId: a.id } });
    }
  }

  const categories: Category[] = db.readObjects(T.category).map((r) => {
    const title = str(r.title).trim();
    const icon = str(r.icon);
    const t = str(r.type);
    return {
      id: str(r.uid),
      title,
      label: title || (icon ? `icon:${icon}` : `без названия (${str(r.uid)})`),
      type: t === MM_SCHEMA.categoryType.income ? 'income' : t === MM_SCHEMA.categoryType.expense ? 'expense' : 'unknown',
      icon,
      removed: flag(r.isRemoved),
    };
  });

  const tags: Tag[] = db.readObjects(T.tag).map((r) => ({ id: str(r.uid), name: str(r.name) }));

  // Связи: читаем в обе стороны (BLOCKERS B3)
  const links = new Map<string, Links>();
  const linkOf = (uid: string): Links => {
    let l = links.get(uid);
    if (!l) links.set(uid, (l = emptyLinks()));
    return l;
  };
  for (const r of db.readObjects(T.syncLink)) {
    if (flag(r.isRemoved)) continue;
    let et = str(r.entityType);
    let eu = str(r.entityUid);
    let ot = str(r.otherType);
    let ou = str(r.otherUid);
    if ((ot === L.transaction || ot === L.transfer) && et !== L.transaction && et !== L.transfer) {
      [et, eu, ot, ou] = [ot, ou, et, eu];
    }
    if (et === L.transaction) {
      if (ot === L.account) linkOf(eu).account.push(ou);
      else if (ot === L.category) linkOf(eu).category.push(ou);
      else if (ot === L.tag) linkOf(eu).tags.push(ou);
    } else if (et === L.transfer) {
      if (ot === L.fromAccount) linkOf(eu).from.push(ou);
      else if (ot === L.toAccount) linkOf(eu).to.push(ou);
    }
  }

  const accountIds = new Set(accounts.map((a) => a.id));
  const categoryIds = new Set(categories.map((c) => c.id));
  const one = (xs: string[], what: string, opId: string): string | null => {
    if (xs.length > 1) warnings.push({ code: 'link.multiple', text: `Операция ${opId}: несколько связей «${what}», взята первая`, refs: { opId } });
    return xs[0] ?? null;
  };

  const operations: Operation[] = [];
  for (const r of db.readObjects(T.transaction)) {
    if (flag(r.isRemoved)) continue;
    const id = str(r.uid);
    const date = str(r.date).slice(0, 10);
    const type = str(r.type);
    if (!isIsoDate(date)) {
      warnings.push({ code: 'tx.date', text: `Операция ${id}: некорректная дата «${str(r.date)}», пропущена`, refs: { opId: id } });
      continue;
    }
    const kind = type === MM_SCHEMA.txType.income ? 'income' : type === MM_SCHEMA.txType.expense ? 'expense' : null;
    if (!kind) {
      warnings.push({ code: 'tx.type', text: `Операция ${id}: неизвестный тип «${type}», пропущена`, refs: { opId: id } });
      continue;
    }
    const l = links.get(id) ?? emptyLinks();
    const accountId = one(l.account, 'счёт', id);
    if (!accountId || !accountIds.has(accountId)) {
      warnings.push({ code: 'tx.account', text: `Операция ${id} от ${date}: не привязана к существующему счёту, в балансы не входит`, refs: { opId: id } });
      continue;
    }
    let categoryId = one(l.category, 'категория', id);
    if (categoryId && !categoryIds.has(categoryId)) {
      warnings.push({ code: 'tx.category', text: `Операция ${id}: категория ${categoryId} не найдена`, refs: { opId: id } });
      categoryId = null;
    }
    const op: TxOperation = {
      kind,
      id,
      date,
      amount: amount(r.amountInDefaultCurrency, `Операция ${id}`, warnings),
      accountId,
      categoryId,
      tagIds: [...l.tags].sort(),
      comment: str(r.comment),
    };
    operations.push(op);
  }

  for (const r of db.readObjects(T.transfer)) {
    if (flag(r.isRemoved)) continue;
    const id = str(r.uid);
    const date = str(r.date).slice(0, 10);
    if (!isIsoDate(date)) {
      warnings.push({ code: 'tr.date', text: `Перевод ${id}: некорректная дата «${str(r.date)}», пропущен`, refs: { opId: id } });
      continue;
    }
    const l = links.get(id) ?? emptyLinks();
    const from = one(l.from, 'счёт списания', id);
    const to = one(l.to, 'счёт зачисления', id);
    if (!from || !to || !accountIds.has(from) || !accountIds.has(to)) {
      warnings.push({ code: 'tr.account', text: `Перевод ${id} от ${date}: не привязан к счетам, в балансы не входит`, refs: { opId: id } });
      continue;
    }
    const fromAmount = amount(r.fromAmount, `Перевод ${id}`, warnings);
    const toAmount = r.toAmount === null || r.toAmount === undefined ? fromAmount : amount(r.toAmount, `Перевод ${id}`, warnings);
    operations.push({ kind: 'transfer', id, date, fromAccountId: from, toAccountId: to, fromAmount, toAmount, comment: str(r.comment) });
  }

  operations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const removedAccounts = new Set(accounts.filter((a) => a.removed).map((a) => a.id));
  const onRemoved = operations.filter((o) => (o.kind === 'transfer' ? removedAccounts.has(o.fromAccountId) || removedAccounts.has(o.toAccountId) : removedAccounts.has(o.accountId)));
  if (onRemoved.length) {
    warnings.push({ code: 'account.removed.ops', text: `${onRemoved.length} операций на удалённых счетах — проверь, не ошибка ли это` });
  }

  const reportedBalances: Record<string, Money> = {};
  for (const r of db.readObjects(T.accountBalance)) {
    const v = r.value;
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
      warnings.push({ code: 'balance.value', text: `account_balance для ${str(r.uid)}: значение «${String(v)}» не целое` });
      continue;
    }
    reportedBalances[str(r.uid)] = tiyn(v);
  }

  return {
    accounts,
    categories,
    tags,
    operations,
    reportedBalances,
    warnings,
    meta: { ...meta, firstDate: operations[0]?.date ?? null, lastDate: operations[operations.length - 1]?.date ?? null },
  };
}

/** Полный импорт файла .mmbackup. */
export function importMmbackup(file: Uint8Array): ImportedData {
  const ex = extractDatabase(file);
  const db = openSqlite(ex.db);
  return readMoneyManager(db, { entryName: ex.entryName, prefixLength: ex.prefixLength, dbBytes: ex.db.length });
}
