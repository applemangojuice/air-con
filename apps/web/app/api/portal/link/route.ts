import { z } from "zod";
import { emailConfigured } from "@/lib/email";
import { portalJson, sendSignInLink, type LinkTarget } from "@/lib/portal-server";
import { clientKey, rateLimitIdentity } from "@/lib/rate-limit";
import { enforceSharedRateLimit, sharedRateLimits } from "@/lib/rate-limit-shared";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Customer sign-in links:
 *
 *   POST /api/portal/link  { projectId }   from a project page: to the email we hold for it
 *                          { documentId }  from a document page: the same, landing on the document
 *                          { email }       from /portal: to that address, if it's a customer's
 *
 * The answer is always the same `{ ok: true, emailLive }` (plus, in
 * development only, the link and its code, since nothing is emailed there), so it
 * never reveals whether a project, document or customer exists, or what
 * address we hold. Rate-limited per address and per target; over the
 * per-target limit it quietly sends nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ projectId: z.string().uuid() }).strict(),
  z.object({ documentId: z.string().uuid() }).strict(),
  z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict(),
]);

export async function POST(request: Request): Promise<Response> {
  // Shared by every instance (rate-limit-shared): each request can be an email to someone's inbox.
  const limited = await enforceSharedRateLimit(request, "portal-link", 8, 15 * 60_000);
  if (limited) return limited;
  if (!getServiceClient()) {
    return portalJson({ ok: false, error: "Sign-in isn't available on this demo site. Try the playable demo instead." }, 503);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return portalJson({ ok: false, error: "That doesn't look like an email address." }, 400);
  }
  const body = parsed.data;
  const target: LinkTarget =
    "projectId" in body
      ? { kind: "project", projectId: body.projectId.toLowerCase() }
      : "documentId" in body
        ? { kind: "document", documentId: body.documentId.toLowerCase() }
        : { kind: "email", email: body.email };
  const key = target.kind === "project" ? target.projectId : target.kind === "document" ? target.documentId : target.email;
  const perTarget = await sharedRateLimits([
    { key: `portal-link-target:${key}`, limit: 3, windowMs: 15 * 60_000 },
    { key: `portal-link-ip:${rateLimitIdentity(clientKey(request))}:${key}`, limit: 2, windowMs: 5 * 60_000 },
  ]);
  if (!perTarget.ok) return portalJson({ ok: true, emailLive: emailConfigured() });

  // Each link is an email anyone can ask for: from the shared daily budget for those (lib/email-budget).
  const result = await sendSignInLink(target, { budget: "sign-in" });
  return portalJson({
    ok: true,
    emailLive: result.emailLive,
    ...(result.devLink ? { devLink: result.devLink, ...(result.devCode ? { devCode: result.devCode } : {}) } : {}),
  });
}
