import { z } from "zod";
import { isPlausibleEmail, normaliseEmail } from "@/lib/auth/access";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { recordDocumentsConsent } from "@/lib/survey-server";

/**
 * POST /api/field/survey/<projectId>/consent { email? }
 *   → { consent: { at, channel: "in-person" }, email? }
 *
 * The customer told the surveyor they're happy to get the proposal and
 * contract documents by email (documents-consent-recorded, in person).
 * Only after the surveyor asked them. An email address can be added when
 * none is on file.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const schema = z.object({ email: z.string().trim().max(254).optional() });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "survey.conduct");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return json({ error: "Not found" }, 404);
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") return json({ error: "Not found" }, 404);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const email = parsed.data.email ? normaliseEmail(parsed.data.email) : undefined;
  if (email && !isPlausibleEmail(email)) return json({ error: "That email address doesn't look right." }, 400);
  try {
    const result = await recordDocumentsConsent(projectId, staff, email);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ consent: result.consent, ...(result.email ? { email: result.email } : {}) });
  } catch (err) {
    console.error("[survey] consent failed:", err);
    return json({ error: "Couldn't record that. Check your signal and try again." }, 502);
  }
}
