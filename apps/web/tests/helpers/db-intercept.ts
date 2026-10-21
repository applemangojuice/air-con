/**
 * Stand in front of the local backend's client for one table while `fn`
 * runs: a database blip on that table, or a look at what's written to it.
 * The local client is shared through globalThis (lib/supabase-server.ts),
 * so every module that calls getServiceClient() sees the stand-in.
 *
 * Only for tests on DATA_BACKEND=memory, after the app modules are loaded.
 */

type Client = { from: (table: string) => unknown };

const CLIENTS = Symbol.for("aircon.local-db.clients");

function clients(): Map<string, Client> {
  const map = (globalThis as unknown as Record<symbol, Map<string, Client> | undefined>)[CLIENTS];
  if (!map || map.size === 0) throw new Error("db-intercept: no local client yet (call getServiceClient() first)");
  return map;
}

/** A query that fails however it's chained: every call returns itself, awaiting it gives `error`. */
export function failingQuery(error: { message: string; code?: string }): unknown {
  const result = { data: null, error, count: null, status: 503, statusText: "Service Unavailable" };
  const q: Record<string | symbol, unknown> = {};
  const proxy: unknown = new Proxy(q, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      return () => proxy;
    },
  });
  return proxy;
}

/**
 * Run `fn` with `from(table)` answered by `handler(real)` (`real` builds the
 * genuine query), then put the real client back.
 */
export async function interceptTable<T>(table: string, handler: (real: () => unknown) => unknown, fn: () => Promise<T>): Promise<T> {
  const map = clients();
  const saved = new Map(map);
  for (const [key, client] of saved) {
    map.set(
      key,
      new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "from") {
            return (name: string) => (name === table ? handler(() => target.from(name)) : target.from(name));
          }
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" ? v.bind(target) : v;
        },
      }),
    );
  }
  try {
    return await fn();
  } finally {
    for (const [key, client] of saved) map.set(key, client);
  }
}

/** Run `fn` while every `update(patch)` on `table` is recorded (and still applied). */
export async function recordUpdates<T>(table: string, fn: () => Promise<T>): Promise<{ result: T; patches: Record<string, unknown>[] }> {
  const patches: Record<string, unknown>[] = [];
  const result = await interceptTable(
    table,
    (real) => {
      const builder = real() as Record<string, unknown>;
      return new Proxy(builder, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver);
          if (prop === "update" && typeof v === "function") {
            return (patch: Record<string, unknown>, ...rest: unknown[]) => {
              patches.push(patch);
              return (v as (...a: unknown[]) => unknown).call(target, patch, ...rest);
            };
          }
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
    fn,
  );
  return { result, patches };
}

/** The same query, but `hook` runs once its result is in and before the caller sees it. */
export function afterAwait(q: unknown, hook: () => Promise<unknown>): unknown {
  return new Proxy(q as object, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          (target as PromiseLike<unknown>).then(async (v) => {
            await hook();
            return v;
          }).then(resolve, reject);
      }
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown).apply(target, args);
        return r && typeof r === "object" && typeof (r as { then?: unknown }).then === "function" ? afterAwait(r, hook) : r;
      };
    },
  });
}
