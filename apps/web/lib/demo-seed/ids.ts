/**
 * Deterministic ids for DEMO records, so a reset gives the same URLs every
 * time (a bookmarked /p/<id> or /ops/projects/<id> keeps working) and tests
 * can name what they expect.
 *
 * Shape: `xxxxxxxx-de5e-4xxx-8xxx-xxxxxxxxxxxx`, a valid RFC 4122 v4-form
 * uuid whose second block reads "de5e" (DEMO SEED), so a demo row is
 * recognisable at a glance. The first block is hashed from the key, so
 * project short ids (document refs use the first 8 characters) differ
 * between demo projects.
 */

/** cyrb128: a small, fast, well-mixed 128-bit string hash. Not cryptographic; it doesn't need to be. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0");

export const DEMO_ID_MARKER = "de5e";

/** The DEMO uuid for a key ("project:3", "media:3:indoor-wall:r1"). Same key, same id, always. */
export function demoId(key: string): string {
  const [a, b, c, d] = cyrb128(`dih-demo-seed:${key}`).map(hex8) as [string, string, string, string];
  return `${a}-${DEMO_ID_MARKER}-4${b.slice(0, 3)}-8${b.slice(3, 6)}-${c}${d.slice(0, 4)}`;
}

/** Was this id minted by the demo seed? */
export function isDemoSeedId(id: string): boolean {
  return /^[0-9a-f]{8}-de5e-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
}
