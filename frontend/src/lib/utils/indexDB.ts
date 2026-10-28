import { createJSONStorage } from "zustand/middleware";

type UseStore = <T>(
  txMode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => T | PromiseLike<T>,
) => Promise<T>;

function promisifyRequest<T = undefined>(
  request: IDBRequest<T> | IDBTransaction,
): Promise<T> {
  const settled = request as IDBRequest<T> & IDBTransaction;
  return new Promise<T>((resolve, reject) => {
    settled.oncomplete = settled.onsuccess = () => resolve(settled.result);
    settled.onabort = settled.onerror = () => reject(settled.error);
  });
}

function createStore(dbName: string, storeName: string): UseStore {
  let DBP: Promise<IDBDatabase> | undefined;
  const getDB = () => {
    if (DBP) return DBP;
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    DBP = promisifyRequest(request);

    DBP.then(
      (db) => {
        db.onclose = () => (DBP = undefined);
      },
      () => {},
    );
    return DBP;
  };

  return (txMode, callback) =>
    getDB().then((db) =>
      callback(db.transaction(storeName, txMode).objectStore(storeName)),
    );
}

export function get<T = unknown>(
  key: IDBValidKey,
  store: UseStore,
): Promise<T | undefined> {
  return store("readonly", (store) => promisifyRequest(store.get(key)));
}

export function set(key: IDBValidKey, value: unknown, store: UseStore): Promise<void> {
  return store("readwrite", (store) => {
    store.put(value, key);
    return promisifyRequest(store.transaction);
  });
}

export function del(key: IDBValidKey, store: UseStore): Promise<void> {
  return store("readwrite", (store) => {
    store.delete(key);
    return promisifyRequest(store.transaction);
  });
}

export function createIndexedDBStorage() {
  return createJSONStorage(() => {
    const store = createStore("Workspace", "workspace");
    return {
      async getItem(key: IDBValidKey) {
        return await get<string>(key, store).then((value) => value || null);
      },
      async setItem(key: IDBValidKey, value: string) {
        await set(key, value, store);
      },
      async removeItem(key: IDBValidKey) {
        await del(key, store);
      },
    };
  });
}

export async function getStorage(key: IDBValidKey) {
  const store = createStore("Workspace", "workspace");
  return await get<string>(key, store).then((value) => value || null);
}
