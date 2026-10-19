import { compact, db, isUuid, must, optStr, type Row } from "./base";

/**
 * `login_tokens`: magic-link tokens. Only sha256(token) is stored, so a
 * database leak can't be replayed. Single use: `markUsed` claims a token
 * atomically, so two clicks (or a click and a link scanner) can't both win.
 */

const TABLE = "login_tokens";

export interface LoginToken {
  id: string;
  tokenHash: string;
  subjectKind: "staff" | "customer";
  /** staff.id or customers.id; null for a first admin sign-in (no staff row yet). */
  subjectId: string | null;
  email: string;
  purpose: string;
  nextPath?: string;
  expiresAt: string;
  usedAt?: string;
  createdAt?: string;
}

export function fromRow(row: Row): LoginToken {
  return compact<LoginToken>({
    id: String(row.id),
    tokenHash: String(row.token_hash),
    subjectKind: row.subject_kind === "customer" ? "customer" : "staff",
    subjectId: row.subject_id === null || row.subject_id === undefined ? null : String(row.subject_id),
    email: String(row.email ?? ""),
    purpose: String(row.purpose ?? "login"),
    nextPath: optStr(row.next_path),
    expiresAt: String(row.expires_at),
    usedAt: optStr(row.used_at),
    createdAt: optStr(row.created_at),
  });
}

export async function insert(token: Omit<LoginToken, "id" | "usedAt" | "createdAt">): Promise<LoginToken> {
  const data = must(
    await db()
      .from(TABLE)
      .insert({
        token_hash: token.tokenHash,
        subject_kind: token.subjectKind,
        subject_id: token.subjectId,
        email: token.email.trim().toLowerCase(),
        purpose: token.purpose,
        next_path: token.nextPath ?? null,
        expires_at: token.expiresAt,
      })
      .select("*")
      .single(),
    "login_tokens insert",
  );
  return fromRow(data!);
}

/**
 * Sign-in links minted for this address since `sinceIso` (the hour-long
 * kind: the 30-day links inside operational emails don't count). Durable,
 * so a per-address cap holds across instances and restarts.
 */
export async function recentSignInLinks(email: string, sinceIso: string, nowIso: string): Promise<number> {
  const signInHorizon = new Date(Date.parse(nowIso) + 2 * 3600_000).toISOString();
  const res = await db()
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("email", email.trim().toLowerCase())
    .gte("created_at", sinceIso)
    .lte("expires_at", signInHorizon);
  if (res.error) throw new Error(`login_tokens count: ${res.error.message}`);
  return res.count ?? 0;
}

export async function findByHash(tokenHash: string): Promise<LoginToken | null> {
  const data = must(
    await db().from(TABLE).select("*").eq("token_hash", tokenHash).maybeSingle(),
    "login_tokens findByHash",
  );
  return data ? fromRow(data) : null;
}

/** Claim an unused token. True only for the one caller that stamped `used_at`. */
export async function markUsed(id: string, atIso: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const data = must(
    await db().from(TABLE).update({ used_at: atIso }).eq("id", id).is("used_at", null).select("id"),
    "login_tokens markUsed",
  );
  return (data ?? []).length === 1;
}

/** Housekeeping: drop tokens that expired before this instant. */
export async function deleteExpired(beforeIso: string): Promise<void> {
  must(await db().from(TABLE).delete().lt("expires_at", beforeIso), "login_tokens deleteExpired");
}
