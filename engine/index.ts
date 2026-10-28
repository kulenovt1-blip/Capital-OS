/**
 * Публичный API движка. UI (app/) импортирует только отсюда.
 * Движок: чистые функции, без DOM, IndexedDB и Date.now(); текущая дата — параметр.
 */
export * from './money';
export * from './date';
export * from './explain';
export * from './types';
export * from './settings';
export * from './classify';
export * from './ledger';
export * from './obligations';
export * from './state';
export * from './overview';
export { importMmbackup, extractDatabase, MM_SCHEMA, categoryDisplayName, categoryNameFromIcon } from './import/mmbackup';
export * from './goals';
export * from './goals-view';
export * from './allocate';
export * from './simulate';
export * from './plan';
export * from './classes';
export * from './setup';
export * from './installment-detect';
export * from './income-kinds';
