import { constantTimeEqual, hmacSha256Hex, sessionSecret } from "./auth/session.ts";

/**
 * The one-click "stop follow-up emails" link in every follow-up's footer
 * (check-ins, the season's tips, the yearly service reminder): the project
 * id and an HMAC of it, so it opens a page with one button without signing
 * in, and works for as long as the emails keep coming. It can only turn
 * follow-ups off for that project (the family turns them back on from
 * their project page). A page with a button, not a link that acts on its
 * own, because mail scanners open links.
 */

const DOMAIN = "stop-follow-ups.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function stopSignature(projectId: string, secret: string | null = sessionSecret()): Promise<string | null> {
  if (!secret || !UUID_RE.test(projectId)) return null;
  return (await hmacSha256Hex(secret, `${DOMAIN}${projectId.toLowerCase()}`)).slice(0, 40);
}

/** The link for one project, or null without a usable secret. */
export async function stopLink(base: string, projectId: string, secret: string | null = sessionSecret()): Promise<string | null> {
  const sig = await stopSignature(projectId, secret);
  return sig ? `${base}/stop?p=${projectId.toLowerCase()}&s=${sig}` : null;
}

/** Is this a link we signed for this project? */
export async function stopLinkValid(projectId: string | undefined, sig: string | undefined, secret: string | null = sessionSecret()): Promise<boolean> {
  if (!projectId || !sig) return false;
  const want = await stopSignature(projectId, secret);
  return Boolean(want) && constantTimeEqual(want!, sig);
}
