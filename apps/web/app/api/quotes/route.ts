import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { logServerEvent } from "@/lib/analytics-server";
import { appUrl } from "@/lib/brand";
import { escapeHtml, quoteEmail, sendEmail, sendTeamEmail } from "@/lib/email";
import { QUOTE_OWNER_COOKIE, quoteOwnerCookieOptions, readQuoteOwner, signQuoteOwner } from "@/lib/auth/quote-owner";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UUID_RE, surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";
import { getPublicSettings } from "@/lib/public-settings";
import {
  CONSENT_VERSION,
  coverageFor,
  installDaysPhrase,
  quoteConsentRecord,
  surveyDurationCopy,
  surveyPriceCopy,
  validUntil,
  vatCopy,
} from "@/components/site/claims";
import { withUploadedPhotosOnly } from "@/lib/quote-draft";

const attributionSchema = z
  .object({
    referrer: z.string().max(600).optional(),
    utmSource: z.string().max(200).optional(),
    utmMedium: z.string().max(200).optional(),
    utmCampaign: z.string().max(200).optional(),
    utmTerm: z.string().max(200).optional(),
    utmContent: z.string().max(200).optional(),
    landingPath: z.string().max(300).optional(),
    firstSeenAt: z.string().max(40).optional(),
  })
  .optional();

/** UK-ish phone: digits, spaces, +, brackets and dashes, 10–13 digits. Empty is fine (optional). */
const phoneSchema = z
  .string()
  .max(30)
  .optional()
  .default("")
  .refine((v) => v.trim() === "" || (/^\+?[\d\s()-]{10,20}$/.test(v.trim()) && v.replace(/\D/g, "").length <= 13), "Invalid phone");

const bodySchema = z.object({
  survey: surveySchema,
  source: z.enum(["web", "ios"]).optional().default("web"),
  /** When present, finalises the draft row created at the address step. */
  draftId: z.string().regex(UUID_RE).optional(),
  /** First-touch acquisition, so a booking traces back to its campaign. */
  attribution: attributionSchema,
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: phoneSchema,
    timeframe: z.enum(["asap", "1-3-months", "researching"]),
  }),
  /**
   * Operational consent (required to save) and marketing consent (optional,
   * never assumed), with the wording version the customer saw.
   */
  consents: z.object({
    operational: z.literal(true),
    marketing: z.boolean(),
    version: z.string().max(40).optional(),
  }),
});

/** Paths /api/uploads mints: `<uuid>/<kind>-<safe name>`. Anything else is dropped. */
const STORAGE_PATH_RE = /^[0-9a-f-]{36}\/[a-z-]+-[A-Za-z0-9._-]{1,80}$/;

/** Only photos we uploaded ourselves, and not too many of them. */
function trustedPhotos(survey: Survey): Survey {
  const kept = withUploadedPhotosOnly(survey);
  const ok = (p: { storagePath?: string }) => STORAGE_PATH_RE.test(p.storagePath ?? "");
  let budget = 40;
  const take = <T extends { storagePath?: string }>(photos: T[]) =>
    photos.filter((p) => ok(p) && budget-- > 0);
  return {
    ...kept,
    rooms: kept.rooms.map((r) => ({ ...r, photos: take(r.photos) })),
    outdoor: { ...kept.outdoor, photos: take(kept.outdoor.photos) },
    electrics: { ...kept.electrics, photos: take(kept.electrics.photos) },
  };
}

export async function POST(request: Request) {
  // A brake on scripted spam, sized for shared IPs (CGNAT, office wifi): a
  // whole household or demo room fits, a bot loop doesn't. The save-early
  // draft row is the backstop if a legitimate burst ever trips this.
  const limited = enforceRateLimit(request, "quotes", 30, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid survey" }, { status: 400 });
  }

  const { contact, source, draftId, attribution, consents } = parsed.data;
  const survey = trustedPhotos(parsed.data.survey as Survey);
  if (survey.rooms.length === 0) {
    return NextResponse.json({ error: "No rooms selected" }, { status: 400 });
  }

  const settings = await getPublicSettings();
  // The server decides coverage; the browser's check is only a preview.
  const coverage = coverageFor(settings.serviceArea, survey.postcode);
  if (!coverage.covered) {
    return NextResponse.json({ error: "out-of-area", outcode: coverage.outcode }, { status: 422 });
  }

  // The server recomputes the quote; the stored price never comes from the client.
  const quote = generateQuote(survey);

  const supabase = getServiceClient();
  if (!supabase) {
    console.info("[demo mode] quote request:", quote.totalGbp);
    return NextResponse.json({ ok: true, demo: true });
  }

  const now = new Date().toISOString();
  const phone = contact.phone.trim();
  const consentRecord = {
    ...quoteConsentRecord({
      marketing: consents.marketing,
      hasPhone: phone.length > 0,
      at: now,
      version: consents.version ?? CONSENT_VERSION,
    }),
    termsVersion: settings.legal.termsVersion,
  };

  const record = {
    customer_name: contact.name,
    email: contact.email,
    phone: phone || null,
    timeframe: contact.timeframe,
    postcode: survey.postcode,
    address_line: survey.addressLine,
    engine_version: quote.engineVersion,
    survey,
    quote,
    total_gbp: quote.totalGbp,
    room_count: survey.rooms.length,
    confidence_score: quote.confidence.score,
    confidence_band: quote.confidence.band,
    source,
    // Consents ride in the attribution JSON (no migration needed): who agreed
    // to what, when, and in which words (UK GDPR Art 7(1)).
    // createProjectForQuote copies them onto customers.ops_consent /
    // marketing_consent (repo/customers consentsFromQuote) when the project starts.
    attribution: { ...(attribution ?? {}), consents: consentRecord },
    referrer: attribution?.referrer ?? null,
    utm_source: attribution?.utmSource ?? null,
  };

  // Finalise the existing draft when we have one; insert otherwise.
  let id: string | null = null;
  let saveError: string | null = null;
  if (draftId) {
    const { data, error } = await supabase
      .from("quote_requests")
      .update({ ...record, status: "new" })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) saveError = error.message;
    id = (data?.id as string | undefined) ?? null;

    // Already finalised (double-submit, browser Back): idempotent success —
    // return the existing quote instead of inserting a duplicate row and
    // emailing the customer twice.
    if (!id) {
      const { data: existing } = await supabase
        .from("quote_requests")
        .select("id, status")
        .eq("id", draftId)
        .maybeSingle();
      if (existing && existing.status !== "draft" && existing.status !== "declined") {
        return NextResponse.json({ ok: true, demo: false, id: existing.id, emailed: false });
      }
    }
  }
  if (!id) {
    const { data, error } = await supabase.from("quote_requests").insert(record).select("id").single();
    if (error || !data) {
      saveError = error?.message ?? saveError ?? "no row returned";
      console.error("quote insert failed:", saveError);
      // Safety net: never lose a lead to a database hiccup. Email the details
      // to the team so it can be recovered by hand.
      await Promise.all([
        alertLeadLost(contact, quote.totalGbp, survey.postcode, saveError),
        logServerEvent("server_error", { where: "quote_insert", error: saveError }),
      ]);
      return NextResponse.json({ error: "Could not save quote", saved: false }, { status: 502 });
    }
    id = data.id as string;
  }

  const email = quoteEmail({
    name: contact.name,
    link: `${appUrl()}/q/${id}`,
    totalGbp: quote.totalGbp,
    roomCount: survey.rooms.length,
    validUntil: validUntil(settings, now),
    installDays: installDaysPhrase(settings),
    vatLine: vatCopy(settings).short,
    surveyPrice: surveyPriceCopy(settings),
    surveyDuration: surveyDurationCopy(settings),
    supportEmail: settings.company.email,
    supportPhone: settings.company.phone,
  });
  const emailed = await sendEmail(contact.email, email.subject, email.html);
  // Ping the team so a real submission is never missed.
  await notifyNewLead(contact, quote.totalGbp, survey.postcode, id, attribution, consents.marketing);
  const res = NextResponse.json({ ok: true, demo: false, id, emailed });
  // This browser saved this quote, so "Book my home survey" can open the
  // project made from it without an email round trip (lib/auth/quote-owner.ts).
  // Only on a fresh save: the idempotent replay above returns before this.
  const held = await readQuoteOwner((await cookies()).get(QUOTE_OWNER_COOKIE)?.value);
  const grant = await signQuoteOwner(id, held).catch(() => null);
  if (grant) res.cookies.set(QUOTE_OWNER_COOKIE, grant, quoteOwnerCookieOptions());
  return res;
}

type Contact = { name: string; email: string; phone: string; timeframe: string };
type Attribution = { referrer?: string; utmSource?: string; utmCampaign?: string } | undefined;

async function notifyNewLead(
  contact: Contact,
  totalGbp: number,
  postcode: string,
  id: string,
  attribution: Attribution,
  marketing: boolean,
): Promise<void> {
  const base = appUrl();
  const source = attribution?.utmCampaign || attribution?.utmSource || attribution?.referrer || "direct";
  await sendTeamEmail(
    `New quote: ${escapeHtml(contact.name)} · ${gbpText(totalGbp)}`,
    `<p><strong>${escapeHtml(contact.name)}</strong> just got a price.</p>
<ul>
  <li>Email: ${escapeHtml(contact.email)}</li>
  <li>Phone: ${escapeHtml(contact.phone || "—")}</li>
  <li>Postcode: ${escapeHtml(postcode)}</li>
  <li>Timeframe: ${escapeHtml(contact.timeframe)}</li>
  <li>Total: ${gbpText(totalGbp)}</li>
  <li>Marketing consent: ${marketing ? "yes" : "no"}</li>
  <li>Came from: ${escapeHtml(source)}</li>
</ul>
<p><a href="${base}/ops/quotes/${id}">Open in ops →</a></p>`,
  );
}

async function alertLeadLost(contact: Contact, totalGbp: number, postcode: string, reason: string): Promise<void> {
  await sendTeamEmail(
    `⚠️ Quote FAILED TO SAVE: ${escapeHtml(contact.name)} — recover by hand`,
    `<p>A customer completed the funnel but the database write failed, so this
lead is <strong>not</strong> in the system. Reach out to them directly.</p>
<ul>
  <li>Name: ${escapeHtml(contact.name)}</li>
  <li>Email: ${escapeHtml(contact.email)}</li>
  <li>Phone: ${escapeHtml(contact.phone || "—")}</li>
  <li>Postcode: ${escapeHtml(postcode)}</li>
  <li>Timeframe: ${escapeHtml(contact.timeframe)}</li>
  <li>Total shown: ${gbpText(totalGbp)}</li>
</ul>
<p>Database error: <code>${escapeHtml(reason)}</code></p>
<p>Check <a href="${appUrl()}/ops/status">/ops/status</a>: the schema is probably not fully migrated.</p>`,
  );
}

function gbpText(totalGbp: number): string {
  return `£${String(Math.round(totalGbp)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
