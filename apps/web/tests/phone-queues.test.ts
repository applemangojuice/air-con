import { test } from "node:test";
import assert from "node:assert/strict";
import { idbConnection } from "../lib/idb-connection.ts";

/*
 * The phone queues' IndexedDB connection, against a fake IndexedDB: a
 * connection the browser dropped is reopened and the write tried once
 * more; a write whose request succeeded but whose transaction aborted
 * (storage full) is a failure, never a silent success.
 */

type Behaviour = "ok" | "closing" | "abort-after-success";

function fakeDb(behaviour: () => Behaviour, rows: Map<string, unknown>) {
  const db = {
    onclose: null as null | (() => void),
    onversionchange: null as null | (() => void),
    close() {},
    transaction() {
      const mode = behaviour();
      if (mode === "closing") throw new DOMException("The database connection is closing.", "InvalidStateError");
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        objectStore() {
          return {
            put(value: { id: string }) {
              const req = { result: value.id as unknown, error: null, onsuccess: null as null | (() => void), onerror: null };
              queueMicrotask(() => {
                req.onsuccess?.();
                if (mode === "abort-after-success") {
                  tx.error = new DOMException("Quota exceeded", "QuotaExceededError");
                  tx.onabort?.();
                } else {
                  rows.set(value.id, value);
                  tx.oncomplete?.();
                }
              });
              return req;
            },
          };
        },
      };
      return tx;
    },
  };
  return db as unknown as IDBDatabase;
}

const put = (value: { id: string }) => (s: IDBObjectStore) => s.put(value);

test("idb: a dropped connection is reopened and the write lands", async () => {
  const rows = new Map<string, unknown>();
  let opens = 0;
  const plan: Behaviour[] = ["ok", "closing", "ok"];
  const conn = idbConnection(async () => {
    opens++;
    return fakeDb(() => plan.shift() ?? "ok", rows);
  });
  await conn.run("readwrite", "items", put({ id: "a" }));
  assert.equal(opens, 1);
  // Safari dropped the connection while the phone was locked: the next write reopens it.
  await conn.run("readwrite", "items", put({ id: "b" }));
  assert.equal(opens, 2);
  assert.deepEqual([...rows.keys()], ["a", "b"]);
});

test("idb: a transaction that aborts after its request succeeded (storage full) is a failure", async () => {
  const rows = new Map<string, unknown>();
  const conn = idbConnection(async () => fakeDb(() => "abort-after-success", rows));
  await assert.rejects(conn.run("readwrite", "items", put({ id: "video" })), /Quota/);
  assert.equal(rows.size, 0);
});

test("idb: the browser closing the connection means the next call opens a fresh one", async () => {
  const rows = new Map<string, unknown>();
  const dbs: IDBDatabase[] = [];
  const conn = idbConnection(async () => {
    const db = fakeDb(() => "ok", rows);
    dbs.push(db);
    return db;
  });
  await conn.run("readwrite", "items", put({ id: "a" }));
  (dbs[0] as unknown as { onclose: () => void }).onclose();
  await conn.run("readwrite", "items", put({ id: "b" }));
  assert.equal(dbs.length, 2);
  assert.equal(rows.size, 2);
});

/* ------------------------------------------------------------------ */
/* Uploads never hang the queue                                        */
/* ------------------------------------------------------------------ */

test("upload: a PUT with no progress for a minute is aborted as retryable; one making progress isn't", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const made: FakeXhr[] = [];
  class FakeXhr {
    status = 0;
    responseText = "";
    timeout = 0;
    upload: { onprogress: null | ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) } = { onprogress: null };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    onabort: null | (() => void) = null;
    aborted = false;
    constructor() {
      made.push(this);
    }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
  }
  const g = globalThis as unknown as { XMLHttpRequest?: unknown };
  const before = g.XMLHttpRequest;
  g.XMLHttpRequest = FakeXhr;
  try {
    const { putWithProgress, MediaUploadError } = await import("../lib/media-client.ts");
    const blob = new Blob(["x".repeat(1000)]);

    // Stalled: nothing after the first bytes.
    const stalled = putWithProgress("https://storage.example/put", blob, "video/mp4", 1);
    const xhr = made[0]!;
    assert.ok(xhr.timeout > 0, "an overall cap is set");
    xhr.upload.onprogress?.({ loaded: 100, total: 1000, lengthComputable: true });
    t.mock.timers.tick(59_000);
    assert.equal(xhr.aborted, false);
    t.mock.timers.tick(2_000);
    await assert.rejects(stalled, (err: unknown) => err instanceof MediaUploadError && err.retryable === true && /stalled/.test(err.message));

    // Slow but moving: never cut off.
    const moving = putWithProgress("https://storage.example/put", blob, "video/mp4", 1);
    const slow = made[1]!;
    for (let i = 1; i <= 5; i++) {
      t.mock.timers.tick(50_000);
      slow.upload.onprogress?.({ loaded: i * 200, total: 1000, lengthComputable: true });
    }
    assert.equal(slow.aborted, false);
    slow.status = 200;
    slow.onload?.();
    await moving;
  } finally {
    g.XMLHttpRequest = before;
  }
});
