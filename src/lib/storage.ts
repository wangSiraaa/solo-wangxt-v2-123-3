import type { Circuit } from './engine/types';

const DB_NAME = 'dc-workbench';
const STORE = 'circuits';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          // 事务完成后再关闭连接
          t.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export const storage = {
  async put(circuit: Circuit): Promise<void> {
    // 传入对象可能是 Svelte $state 代理，IndexedDB 结构化克隆无法克隆代理；
    // 先经 JSON 转为纯对象
    const record: Circuit = JSON.parse(JSON.stringify({ ...circuit, updatedAt: Date.now() }));
    await tx('readwrite', (s) => s.put(record));
  },

  async get(id: string): Promise<Circuit | undefined> {
    return tx('readonly', (s) => s.get(id));
  },

  async list(): Promise<Circuit[]> {
    const all = await tx<Circuit[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },
};
