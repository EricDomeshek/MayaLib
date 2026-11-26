// Minimal promise wrapper over IndexedDB (two stores: key-value metadata and captures).
const DB_NAME = 'mayalib-spike0';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('captures', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(r.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export const kvGet = <T>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key));
export const capturePut = (value: unknown) => tx('captures', 'readwrite', (s) => s.put(value));
export const captureAll = <T>() => tx<T[]>('captures', 'readonly', (s) => s.getAll());
export const captureClear = () => tx('captures', 'readwrite', (s) => s.clear());
