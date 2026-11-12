/** Состояние защиты данных от удаления браузером (D176): запрос при запуске, чтение — из экранов. */
import { requestPersistence, type PersistStatus } from './persist';

let status: PersistStatus = 'unknown';

export const persistStatus = (): PersistStatus => status;

export async function initPersistence(): Promise<PersistStatus> {
  status = await requestPersistence(typeof navigator !== 'undefined' ? (navigator.storage as unknown as Parameters<typeof requestPersistence>[0]) : undefined);
  return status;
}
