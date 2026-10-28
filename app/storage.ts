/** Тонкая обёртка над IndexedDB: одно хранилище «ключ → значение» (DECISIONS D2, вместо idb). */
const DB_NAME = 'capital-os';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const storage = {
  get<T>(key: string): Promise<T | undefined> {
    return tx('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },
  set(key: string, value: unknown): Promise<void> {
    return tx('readwrite', (s) => s.put(value, key)).then(() => undefined);
  },
  remove(key: string): Promise<void> {
    return tx('readwrite', (s) => s.delete(key)).then(() => undefined);
  },
};
