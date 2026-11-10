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
export { importMmbackup, extractDatabase, MM_SCHEMA, categoryDisplayName, categoryName, categoryNameFromIcon } from './import/mmbackup';
export * from './goals';
export * from './goals-view';
export * from './allocate';
export * from './simulate';
export * from './plan';
export * from './classes';
export * from './setup';
export * from './installment-detect';
export * from './income-kinds';
export * from './simple';
export * from './sanity';
export * from './stage';
export * from './saving';
export * from './route';
export * from './roadmap';
export * from './hidden';
export * from './position/settings';
export * from './position/inputs';
export * from './position/view';
export * from './position/series';
export * from './position/sources';
export * from './position/indicators';
export * from './position/directions';
export * from './position/limits';
export * from './position/unknown';
export * from './position/range';
export * from './position/confidence';
export * from './position/level';
export * from './position/runway';
export * from './position/spiral';
export * from './position/independence';
