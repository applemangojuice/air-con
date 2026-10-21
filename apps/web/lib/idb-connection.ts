/**
 * One IndexedDB connection that survives the browser dropping it, for the
 * phone's queues (the field outbox, the survey's photo queue).
 *
 * Safari on iOS drops a suspended page's connection ("Connection to Indexed
 * Database server lost"), a version change asks open connections to close,
 * and a write can fail after its request succeeded (storage full shows up
 * as the transaction aborting). So every call here waits for its
 * transaction to commit, not just the request, and a failure is retried
 * once on a freshly opened connection before it's reported.
 */

export interface IdbConnection {
  /** Opens (or reopens) the database; rejects when IndexedDB can't be used at all. */
  ready(): Promise<IDBDatabase>;
  /** One request in its own transaction; resolves once the transaction has committed. */
  run<T>(mode: IDBTransactionMode, store: string, request: (s: IDBObjectStore) => IDBRequest<T>): Promise<T>;
}

export function idbConnection(open: () => Promise<IDBDatabase>): IdbConnection {
  let current: Promise<IDBDatabase> | null = null;

  function ready(): Promise<IDBDatabase> {
    if (!current) {
      const opening = open().then(
        (db) => {
          // Closed under us (the browser, or another tab upgrading): open a fresh one next time.
          db.onclose = () => {
            if (current === opening) current = null;
          };
          db.onversionchange = () => {
            db.close();
            if (current === opening) current = null;
          };
          return db;
        },
        (err) => {
          if (current === opening) current = null;
          throw err;
        },
      );
      current = opening;
    }
    return current;
  }

  function once<T>(db: IDBDatabase, mode: IDBTransactionMode, store: string, request: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let result: T;
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error || (err && typeof err === "object") ? err : new Error(String(err)));
      };
      try {
        const tx = db.transaction(store, mode);
        const req = request(tx.objectStore(store));
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        tx.onerror = () => fail(tx.error ?? req.error ?? new Error("IndexedDB request failed"));
        tx.onabort = () => fail(tx.error ?? new Error("IndexedDB transaction aborted"));
      } catch (err) {
        // InvalidStateError: the connection is closing or closed.
        fail(err);
      }
    });
  }

  async function run<T>(mode: IDBTransactionMode, store: string, request: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    try {
      return await once(await ready(), mode, store, request);
    } catch {
      // Throw this connection away and try once more on a fresh one; a second failure is real.
      current = null;
      return once(await ready(), mode, store, request);
    }
  }

  return { ready, run };
}

/** Ask the browser not to clear this site's storage under pressure (Safari and Chrome decide without asking). Best-effort. */
export function askForPersistentStorage(): void {
  try {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage;
    if (!storage?.persist || !storage.persisted) return;
    void storage
      .persisted()
      .then((already) => (already ? true : storage.persist()))
      .catch(() => undefined);
  } catch {
    // Not available here: nothing to do.
  }
}
