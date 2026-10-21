/**
 * HS256 JSON Web Tokens with node:crypto only: the API keys of the
 * Supabase-shaped stack (an `anon` and a `service_role` key, as a Supabase
 * project issues them) and the Storage API's signed-URL tokens.
 *
 *   node supabase/tests/compat/jwt.mjs <secret> <role> [ttl-seconds]
 *
 * prints a key for that role (default lifetime ten years, like Supabase's).
 * Test harness only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const b64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function signJwt(payload, secret) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** The payload, or { error } when the token is malformed, forged or expired. */
export function verifyJwt(token, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string") return { error: "jwt malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { error: "jwt malformed" };
  const [head, body, sig] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { error: "jwt malformed" };
  }
  if (header?.alg !== "HS256") return { error: "invalid algorithm" };
  const want = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { error: "invalid signature" };
  if (typeof payload?.exp === "number" && payload.exp < nowSec) return { error: "jwt expired" };
  return { payload };
}

/** A Supabase-style API key: { iss: "supabase", role, iat, exp }. */
export function apiKey(secret, role, ttlSeconds = 10 * 365 * 24 * 3600) {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt({ iss: "supabase", ref: "compat", role, iat, exp: iat + ttlSeconds }, secret);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [secret, role, ttl] = process.argv.slice(2);
  if (!secret || secret.length < 32 || !role) {
    console.error("usage: node jwt.mjs <secret, at least 32 characters> <role> [ttl-seconds]");
    process.exit(2);
  }
  process.stdout.write(apiKey(secret, role, ttl ? Number(ttl) : undefined));
}
