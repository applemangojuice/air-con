import {
  COMMS_EVENTS,
  EARLY_START_WORDING_VERSION,
  FOLLOW_UP_EVENTS,
  INSTALL_LEAD_DAYS,
  RESCHEDULE_FEES,
  ROLE_LABEL,
  TAX_CODES,
  cancellationSentence,
  earlyStartWording,
  effectiveTaxCode,
  isPlaceholderPhone,
  schedule2Missing,
  performanceCommitment,
  settingsForProposal,
  type CommsEventId,
  type ContractType,
  type InvoiceKind,
  type Payment,
  type PilotSettings,
  type ProposalTerms,
  type StaffRole,
  type TermsSection,
} from "@aircon/domain";
import { brandedEmail, escapeHtml } from "../email.ts";
import { fmtDate, fmtDay, fmtDayTime, money } from "../format.ts";
import { fitSms, gsmSafe, smsLength } from "../providers/sms.ts";
import { CANCELLATION_NOTICE_VERSION, cancellationForm, cancellationInstructions, type TraderDetails } from "./legal-text.ts";
import { onTheWayChannel, onTheWayLine, type OnTheWayChannel } from "./on-the-way.ts";

/**
 * One renderer per comms event (contract §F): typed data in, `{ subject,
 * html, text, sms? }` out. The outbox stores exactly what this returns.
 *
 * Every customer message: names us, greets them by first name, says which
 * property or appointment it's about, what happened and what happens next,
 * has one clear link (a fresh magic link to the right portal screen) and
 * the support phone and email. No marketing, ever: these are service
 * messages. Money, contract and safety copy is calm and plain.
 *
 * SMS: our sender is one-way (alphanumeric), so every text carries our
 * phone number and says replies aren't read. GSM-7 only (no curly quotes or
 * emoji: one would cut each segment to 70 characters), two segments (306
 * characters) at most; each template offers shorter fallbacks for long
 * names and addresses.
 *
 * Follow-ups (FOLLOW_UP_EVENTS) end with an opt-out line. The proposal and
 * acceptance emails carry the pre-contract information in full: they are
 * the durable medium (CCR 2013 regs 10 and 12).
 *
 * Pure (no I/O, no clock): `node --test` renders every event directly.
 */

/* ------------------------------------------------------------------ */
/* Event data                                                          */
/* ------------------------------------------------------------------ */

type EmptyData = Record<string, never>;

/** One option as the pre-contract information describes it: what it is and what it costs. */
export interface OptionSummary {
  label: string;
  summary?: string;
  /** "Main bedroom: 2.5 kW wall unit". */
  rooms?: string[];
  highlights?: string[];
  /** The total the customer pays, including any VAT. */
  totalPence: number;
  /** The VAT treatment's label, when VAT is charged. */
  taxLabel?: string;
  installDays?: number;
}

/** What the proposal record adds to the pre-contract information (the issue and acceptance emails). */
interface ProposalDetails {
  contractType?: ContractType;
  /** From the proposal record; without it, `rooms` describes the job. */
  options?: OptionSummary[];
  /** The project's rooms and units, when the record couldn't be read. */
  rooms?: string[];
  installDays?: number;
  inclusions?: string[];
  exclusions?: string[];
  /** What the price assumes (how anything not priced in advance is worked out). */
  assumptions?: string[];
  /** The proposal's own warranty wording, which wins over settings. */
  warranty?: string | null;
  /** The proposal's frozen guarantee lines (withSettingsWording), which win over settings. */
  guarantees?: string[];
  /** The payment terms and cancellation days the proposal was issued on, which win over settings. */
  terms?: ProposalTerms;
  /** The full terms text frozen on the proposal, printed in full at the end of the email. */
  termsText?: TermsSection[];
  termsVersion?: string;
}

/** What each event needs beyond the shared context. Optional fields are left out of the copy when absent. */
export interface CommsData {
  "magic-link": { link: string; name?: string; audience?: "staff" | "customer"; expiresInMinutes?: number };
  "survey-booked": {
    scheduledFor: string; // UK wall-clock as UTC
    durationMinutes?: number;
    mode?: "in-person" | "video";
    surveyorName?: string;
    rescheduled?: boolean;
    feeGbp?: number;
  };
  "survey-reminder": { scheduledFor: string; durationMinutes?: number; mode?: "in-person" | "video"; surveyorName?: string };
  "surveyor-on-my-way": { etaMinutes: number; at: string; name?: string };
  /** needsDocumentsConsent: they didn't agree to documents by email at the survey, and the proposal can't go without it. */
  "survey-complete": { proposalBy?: string; needsDocumentsConsent?: boolean };
  "proposal-issued": ProposalDetails & { version: number; validUntil: string; optionCount?: number; engineerApproved?: boolean };
  "proposal-reminder": { version?: number; validUntil: string };
  "proposal-accepted": {
    version: number;
    optionLabel: string;
    contractTotalPence: number;
    acceptedAt: string; // real instant
    signedName?: string;
    termsVersion?: string;
    cancellationNoticeVersion?: string;
    cancellationEndsOn?: string;
    earlyStartRequested: boolean;
    acknowledgedLossOfRight?: boolean;
    installDays?: number;
    proposalRef?: string;
    contractType?: ContractType;
    /** The chosen option in full, from the proposal record. */
    option?: OptionSummary;
    inclusions?: string[];
    exclusions?: string[];
    assumptions?: string[];
    warranty?: string | null;
    /** The proposal's frozen guarantee lines, terms and terms text (see ProposalDetails). */
    guarantees?: string[];
    terms?: ProposalTerms;
    termsText?: TermsSection[];
    /** The early-start wording version the reply asks for. */
    earlyStartWordingVersion?: string;
  };
  "proposal-changes-requested": { text: string; version?: number };
  "invoice-issued": {
    invoiceNumber: string;
    kind: InvoiceKind;
    totalPence: number;
    outstandingPence?: number;
    dueOn?: string;
    /** Is card payment actually available (Stripe set up, or the demo simulator)? Absent: the settings' methods decide. */
    cardPayments?: boolean;
  };
  "payment-received": {
    amountPence: number;
    receivedAt: string;
    invoiceNumber?: string;
    method?: Payment["method"];
    outstandingPence?: number;
  };
  "install-booked": { dates: string[]; crew?: { name: string; role: StaffRole }[]; prep?: string[]; moved?: boolean };
  "kit-update": { status: "confirmed" | "delivered" | "inspected"; expectedDate?: string; shortages?: number };
  "install-prep": { startDate: string; prep?: string[] };
  "install-day-before": { startDate: string; crewNames?: string[]; arrival?: string; parkingNotes?: string };
  "installer-on-my-way": { etaMinutes: number; at: string; name?: string };
  "install-day-update": {
    n: number;
    totalDays?: number;
    text: string;
    photoCount?: number;
    nextDate?: string;
    by?: string;
    /** The install was already complete (commissioning signed) when the day was ended: "next" is behind them. */
    complete?: { handoverPack: boolean };
  };
  "variation-approval": { title: string; description?: string; totalDeltaPence: number; issueNumber?: number };
  "variation-accepted": {
    title: string;
    description?: string;
    issueNumber?: number;
    priceDeltaNetPence: number;
    taxPence: number;
    totalDeltaPence: number;
    acceptedAt: string;
    /** The name the customer typed, and the words on the button they pressed. */
    name: string;
    wording: string;
    /** The contract total with this change, when known. */
    newContractTotalPence?: number;
  };
  "cancellation-confirmed": {
    /** When the cancellation reached us (an instant), and how. */
    receivedAt: string;
    channel: string;
    refundDueBy: string;
    /** What they've paid us (net of any refunds so far), to come back. */
    paidPence: number;
    /** We supplied equipment that's with them, or with us for them. */
    collectEquipment?: boolean;
    withinPeriod?: boolean;
    /** Work began at their request before the period ended: an amount may be due for it (CCR reg 36(4)). */
    workStartedEarly?: boolean;
  };
  "issue-update": { title: string; update: string; nextStep?: string; dueOn?: string; issueNumber?: number };
  "handover-ready": { electricalCertPending?: boolean };
  "certificate-issued": { kind: "electrical-certificate" | "warranty-confirmation" };
  "check-in-7d": EmptyData;
  "feedback-30d": EmptyData;
  /** The review link comes from settings (company.reviewUrl); the outbox won't send without one. */
  "review-request": EmptyData;
  "seasonal-check": { mode: "heating" | "cooling" };
  "service-reminder": { dueOn: string };
  "team-alert": {
    title: string;
    detail?: string;
    lines?: string[];
    urgent?: boolean;
    /** Add the "legal wording not reviewed" warning when settings say so (acceptances). */
    legalCheck?: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* Shared context                                                      */
/* ------------------------------------------------------------------ */

export interface TemplateContext {
  settings: PilotSettings;
  /** Full name, "" when unknown. */
  customerName: string;
  /** "there" when unknown, so "Hi there," still reads. */
  firstName: string;
  addressLine: string;
  postcode: string;
  /**
   * The one link: the ops page for team mail; for customers, LINK_PLACEHOLDER,
   * which the outbox swaps for a fresh magic link only as it sends.
   */
  portalUrl: string;
  projectId?: string;
  customerEmail?: string;
  customerPhone?: string;
  /** How "on my way" will reach them (lib/comms/on-the-way.ts), so the copy only promises what happens. */
  onTheWay: OnTheWayChannel;
  /**
   * They opted in to marketing. Only asked for MARKETING_OFFER_EVENTS
   * (outbox-core), whose offer line needs it; false everywhere else.
   */
  marketingConsent: boolean;
}

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "dame", "rev"]);

/** "Sam Taylor" → "Sam"; "Dr Sam Taylor" → "Dr Taylor"; DEMO-labelled fixtures skip the label. */
export function firstNameOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words[0] === "DEMO") words.shift();
  if (words.length === 0) return "there";
  if (TITLES.has(words[0].toLowerCase().replace(/\.$/, "")) && words.length > 1) {
    return `${words[0]} ${words[words.length - 1]}`;
  }
  return words[0];
}

export function templateContext(input: {
  settings: PilotSettings;
  portalUrl: string;
  project?: {
    id: string;
    customer: { name: string; email?: string; phone?: string; addressLine: string; postcode: string };
  } | null;
  /** Overrides the project customer's name (staff sign-in links, explicit recipients). */
  recipientName?: string;
  /** Which providers are live (the outbox passes them); previews leave it out, which reads as demo mode. */
  live?: { sms: boolean; email: boolean };
  /** Marketing consent, for templates with an offer line (MARKETING_OFFER_EVENTS). Absent: no. */
  marketingConsent?: boolean;
}): TemplateContext {
  const c = input.project?.customer;
  const name = (input.recipientName ?? c?.name ?? "").trim();
  return {
    settings: input.settings,
    customerName: name,
    firstName: firstNameOf(name),
    addressLine: c?.addressLine?.trim() ?? "",
    postcode: c?.postcode?.trim() ?? "",
    portalUrl: input.portalUrl,
    projectId: input.project?.id,
    customerEmail: c?.email,
    customerPhone: c?.phone,
    onTheWay: onTheWayChannel({ phone: c?.phone, email: c?.email }, input.live ?? { sms: false, email: false }),
    marketingConsent: input.marketingConsent === true,
  };
}

/** Where each event's one link goes, relative to the project. Team events link to ops. */
const PORTAL_PATH: Record<CommsEventId, string | null> = {
  "magic-link": null, // carries its own URL
  "survey-booked": "#survey",
  "survey-reminder": "#survey",
  "surveyor-on-my-way": "#survey",
  "survey-complete": "#survey",
  "proposal-issued": "/proposal",
  "proposal-reminder": "/proposal",
  "proposal-accepted": "#booking",
  "proposal-changes-requested": null,
  "invoice-issued": "/pay",
  "payment-received": "/pay",
  "install-booked": "#booking",
  "kit-update": "#kit",
  "install-prep": "#booking",
  "install-day-before": "#install",
  "installer-on-my-way": "#install",
  "install-day-update": "#install",
  "variation-approval": "#install",
  "variation-accepted": "/documents",
  "cancellation-confirmed": "",
  "issue-update": "",
  "handover-ready": "#handover",
  "certificate-issued": "/documents",
  "check-in-7d": "#aftercare",
  "feedback-30d": "#aftercare",
  "review-request": "#aftercare", // only if there's no review link to send them to
  "seasonal-check": "#aftercare",
  "service-reminder": "#aftercare",
  "team-alert": null,
};

/**
 * The path the event's link should open: `/p/{id}…` for customer events,
 * `/ops/projects/{id}` for team ones. Null for magic-link (it brings its own)
 * or when there's no project to point at.
 */
export function linkPathFor(event: CommsEventId, projectId: string | undefined): string | null {
  if (event === "magic-link") return null;
  if (COMMS_EVENTS[event].audience !== "customer") return projectId ? `/ops/projects/${projectId}` : "/ops";
  if (!projectId) return null;
  const suffix = PORTAL_PATH[event] ?? "";
  return `/p/${projectId}${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const isDate = (iso: string | undefined): iso is string =>
  typeof iso === "string" && Number.isFinite(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`));
const isInstant = (iso: string | undefined): iso is string => typeof iso === "string" && Number.isFinite(Date.parse(iso));

// A malformed date prints as written rather than as "undefined NaN".

/** "Tuesday 3 November" from a date or a wall-clock datetime. */
function dayLong(iso: string): string {
  if (!isDate(iso)) return iso;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${DAY_FULL[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_FULL[d.getUTCMonth()]}`;
}

/** "3 Nov 2026" (lib/format), as written when malformed. */
const dateLong = (iso: string) => (isDate(iso) ? fmtDate(iso) : iso);

/** "10:00" from a UK-wall-clock-as-UTC appointment time. */
function wallClock(iso: string): string {
  if (!isInstant(iso)) return "";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** lib/format's short forms, guarded the same way. */
const shortDay = (iso: string) => (isDate(iso) ? fmtDay(iso) : iso);
const shortDayTime = (iso: string) => (isInstant(iso) ? fmtDayTime(iso) : iso);

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A real instant in London time: { date: "2026-11-03", time: "10:40" }. */
function london(isoInstant: string): { date: string; time: string } {
  if (!isInstant(isoInstant)) return { date: isoInstant, time: "" };
  const parts = Object.fromEntries(LONDON_PARTS.formatToParts(new Date(isoInstant)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Arrival clock time for an on-my-way text: when they pressed it plus the ETA, in London. */
function arrivalTime(at: string, etaMinutes: number): string | null {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms) || !Number.isFinite(etaMinutes)) return null;
  return london(new Date(ms + etaMinutes * 60_000).toISOString()).time;
}

function minutesPhrase(n: number): string {
  if (n >= 60 && n % 60 === 0) return n === 60 ? "an hour" : `${n / 60} hours`;
  return `${Math.round(n)} minutes`;
}

/** "A", "A and B", "A, B and C". */
function listJoin(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** "12 Example Road, SW16 1AA", or "your home" when we don't have it. */
function place(ctx: TemplateContext): string {
  if (!ctx.addressLine) return ctx.postcode ? `your home in ${ctx.postcode}` : "your home";
  return ctx.postcode && !ctx.addressLine.includes(ctx.postcode) ? `${ctx.addressLine}, ${ctx.postcode}` : ctx.addressLine;
}

function vatLine(settings: PilotSettings): string {
  if (!settings.tax.vatRegistered) return "None charged: we're not VAT registered";
  return `${TAX_CODES[effectiveTaxCode(settings)].label}, included in the price`;
}

const INVOICE_KIND: Record<InvoiceKind, string> = {
  deposit: "deposit",
  balance: "balance",
  variation: "variation",
  "survey-fee": "survey fee",
  "change-fee": "date change fee",
  "credit-note": "credit note",
};

/* ------------------------------------------------------------------ */
/* Blocks: one tree renders to both HTML and plain text                */
/* ------------------------------------------------------------------ */

type Inline = string | { strong: string };
type Para = Inline | Inline[];
type Block =
  | { p: Para }
  | { small: Para }
  | { h: string }
  | { list: Para[] }
  | { facts: [string, string][] }
  | { quote: string }
  | { box: string[] };

const inlines = (p: Para): Inline[] => (Array.isArray(p) ? p : [p]);
const paraText = (p: Para) => inlines(p).map((i) => (typeof i === "string" ? i : i.strong)).join("");
const multiline = (s: string) => escapeHtml(s).replace(/\r?\n/g, "<br>");
const paraHtml = (p: Para) =>
  inlines(p)
    .map((i) => (typeof i === "string" ? multiline(i) : `<strong>${multiline(i.strong)}</strong>`))
    .join("");

function blockHtml(b: Block): string {
  if ("p" in b) return `<p style="margin:0 0 14px;line-height:1.5">${paraHtml(b.p)}</p>`;
  if ("small" in b) return `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#5d6371">${paraHtml(b.small)}</p>`;
  if ("h" in b) return `<h2 style="margin:22px 0 10px;font-size:16px;line-height:1.3">${escapeHtml(b.h)}</h2>`;
  if ("list" in b) {
    return `<ul style="margin:0 0 14px;padding-left:20px;line-height:1.5">${b.list
      .map((li) => `<li style="margin:0 0 6px">${paraHtml(li)}</li>`)
      .join("")}</ul>`;
  }
  if ("facts" in b) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14px">${b.facts
      .map(
        ([k, v]) =>
          `<tr><td style="padding:7px 12px 7px 0;border-bottom:1px solid #ece6da;color:#5d6371;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:7px 0;border-bottom:1px solid #ece6da;font-weight:600">${multiline(v)}</td></tr>`,
      )
      .join("")}</table>`;
  }
  if ("quote" in b) {
    return `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #f2711b;background:#f8f5ef;line-height:1.5">${multiline(b.quote)}</blockquote>`;
  }
  return `<div style="margin:0 0 18px;padding:14px 16px;border:1px dashed #ddd5c4;border-radius:12px;font-size:13px;line-height:1.6">${b.box
    .map(multiline)
    .join("<br>")}</div>`;
}

function blockText(b: Block): string {
  if ("p" in b) return paraText(b.p);
  if ("small" in b) return paraText(b.small);
  if ("h" in b) return b.h.toUpperCase();
  if ("list" in b) return b.list.map((li) => `- ${paraText(li)}`).join("\n");
  if ("facts" in b) return b.facts.map(([k, v]) => `${k}: ${v.replace(/\n/g, ", ")}`).join("\n");
  if ("quote" in b) return b.quote.split(/\r?\n/).map((l) => `> ${l}`).join("\n");
  return b.box.join("\n");
}

const buttonHtml = (label: string, href: string) =>
  `<p style="margin:4px 0 24px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#a84508;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">${escapeHtml(label)}</a></p>`;

/** What a template returns; `wrap` adds the greeting, the button, the sign-off and support details. */
interface Draft {
  subject: string;
  body: Block[];
  cta?: string;
  /** The button goes here instead of the portal (an external page, like the review site). */
  ctaHref?: string;
  /** After the button (legal text, small print). */
  after?: Block[];
  /** SMS candidates, longest first; the first that fits two segments wins. */
  sms?: string[];
}

export interface RenderedMessage {
  subject: string;
  html: string;
  text: string;
  sms?: string;
}

function wrap(event: CommsEventId, ctx: TemplateContext, d: Draft): RenderedMessage {
  const { company } = ctx.settings;
  const audience = COMMS_EVENTS[event].audience;
  const team = audience === "team";
  const blocks: Block[] = [];
  if (!team) blocks.push({ p: `Hi ${ctx.firstName},` });
  blocks.push(...d.body);

  const html: string[] = blocks.map(blockHtml);
  const text: string[] = blocks.map(blockText);
  const href = d.ctaHref ?? ctx.portalUrl;
  if (d.cta && href) {
    html.push(buttonHtml(d.cta, href));
    text.push(`${d.cta}: ${href}`);
  }

  const tail: Block[] = [...(d.after ?? [])];
  if (team) {
    tail.push({ small: `Team alert from the ${company.tradingName} platform.` });
  } else {
    tail.push({ p: `Thanks,\nThe ${company.tradingName} team` });
    tail.push({ small: phoneOf(ctx.settings) ? `Questions? Call us on ${company.phone} or email ${company.email}.` : `Questions? Email us at ${company.email}.` });
    if (FOLLOW_UP_EVENTS.has(event)) tail.push({ small: optOutLine(ctx) });
    if (event !== "magic-link" && (ctx.addressLine || ctx.postcode)) {
      tail.push({ small: `This message is about your project at ${place(ctx)}.` });
    }
  }
  for (const b of tail) {
    html.push(blockHtml(b));
    text.push(blockText(b));
  }

  const out: RenderedMessage = {
    subject: d.subject.replace(/\s+/g, " ").trim(),
    html: brandedEmail(html.join("\n")),
    text: text.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
  if (d.sms && COMMS_EVENTS[event].channels.includes("sms")) out.sms = fitSms(d.sms.map(gsm7Only));
  return out;
}

/**
 * GSM-7 only: typographic punctuation and accents made plain (gsmSafe), then
 * anything still outside the GSM set (emoji, other scripts in a name or an
 * address) dropped, so a text never falls back to 70-character segments.
 */
function gsm7Only(text: string): string {
  return [...gsmSafe(text)]
    .filter((ch) => smsLength(ch).encoding === "gsm7")
    .join("")
    .replace(/ +([,.])/g, "$1")
    .replace(/ {2,}/g, " ");
}

/**
 * The phone number to print, or null while settings hold only the shipped
 * stand-in ("0800 000 0000"): a customer is never sent a number nobody
 * answers. `reach` is the mid-sentence "call 020 …" / "email hello@…".
 */
const phoneOf = (settings: PilotSettings): string | null =>
  isPlaceholderPhone(settings.company.phone) ? null : settings.company.phone.trim();
function reach(settings: PilotSettings, opts: { capital?: boolean; us?: boolean } = {}): string {
  const phone = phoneOf(settings);
  const verb = phone ? "call" : "email";
  const head = opts.capital ? verb[0]!.toUpperCase() + verb.slice(1) : verb;
  const target = phone ?? settings.company.email;
  return opts.us ? `${head} us ${phone ? "on" : "at"} ${target}` : `${head} ${target}`;
}

/** Every follow-up ends with this (FOLLOW_UP_EVENTS). The outbox honours it: see aftercare-opt-out. */
function optOutLine(ctx: TemplateContext): string {
  const { email } = ctx.settings.company;
  const phone = phoneOf(ctx.settings);
  return `Don't want follow-up emails like this one? Email ${email}${phone ? ` or call ${phone}` : ""} and we'll stop them. We'll still contact you about any open work, problem or payment.`;
}

/* ------------------------------------------------------------------ */
/* Pre-contract information (CCR 2013 Schedule 2)                      */
/* ------------------------------------------------------------------ */

const traderOf = (settings: PilotSettings): TraderDetails => {
  const c = settings.company;
  return {
    legalName: c.legalName,
    tradingName: c.tradingName,
    geographicAddress: c.geographicAddress,
    registeredAddress: c.registeredAddress,
    ...(isPlaceholderPhone(c.phone) ? {} : { phone: c.phone }),
    email: c.email,
  };
};

const PAYMENT_METHOD: Record<PilotSettings["payments"]["methods"][number], string> = {
  card: "card",
  "bank-transfer": "bank transfer",
};

/** "with less than 7 days' notice, £150" from the installation fee bands. */
function dateChangeFee(): { freeFromDays: number; feePence: number } | null {
  const bands = RESCHEDULE_FEES.installation;
  const charged = bands.filter((b) => b.feeGbp > 0).sort((a, b) => b.feeGbp - a.feeGbp)[0];
  const free = bands.filter((b) => b.feeGbp === 0).sort((a, b) => a.minDaysNotice - b.minDaysNotice)[0];
  return charged && free ? { freeFromDays: free.minDaysNotice, feePence: charged.feeGbp * 100 } : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything Schedule 2 asks for, from settings and the proposal, as one
 * section of the issue and acceptance emails (the durable medium). Each
 * part names its paragraph for the solicitor's review. NEEDS SOLICITOR
 * REVIEW, with the cancellation wording (settings.legal.cancellationReviewed).
 */
function preContractInfo(ctx: TemplateContext, x: ProposalDetails & { cancellation: string; validUntil?: string }): Block[] {
  // What the customer was offered: the proposal's frozen terms over today's settings.
  const { company, payments, warranty, tax, scheduling } = settingsForProposal(ctx.settings, x.terms ? { terms: x.terms } : null);
  const supply = x.contractType !== "install-only";
  const out: Block[] = [];

  // (b), (c), (e): who we are and how to reach us.
  const identity =
    company.tradingName.trim() && company.tradingName.trim() !== company.legalName.trim()
      ? `${company.legalName}, trading as ${company.tradingName}`
      : company.legalName;
  const who: [string, string][] = [["Business", `${identity}${company.companyNumber ? ` (company number ${company.companyNumber})` : ""}`]];
  if (company.geographicAddress.trim()) who.push(["Address", company.geographicAddress.trim()]);
  const office = company.registeredAddress?.trim();
  if (office && office !== company.geographicAddress.trim()) who.push(["Registered office", office]);
  if (!isPlaceholderPhone(company.phone)) who.push(["Phone", company.phone]);
  who.push(["Email", company.email]);
  out.push({ h: "Who we are" }, { facts: who });

  // (a): the main characteristics.
  out.push({ h: "What you're getting" });
  out.push({
    p: supply
      ? "We supply the equipment below, install it, then connect, test and commission it."
      : "You supply the equipment; we install it, then connect, test and commission it.",
  });
  const options = x.options ?? [];
  for (const o of options) {
    if (options.length > 1) out.push({ p: { strong: o.label } });
    if (o.summary?.trim()) out.push({ p: o.summary.trim() });
    const items = [...(o.rooms ?? []), ...(o.highlights ?? [])].filter((i) => i.trim());
    const days = o.installDays ?? x.installDays;
    if (days) items.push(`Installation: ${plural(days, "working day")}.`);
    if (items.length) out.push({ list: items });
  }
  if (!options.length) {
    const items = [...(x.rooms ?? [])];
    if (x.installDays) items.push(`Installation: ${plural(x.installDays, "working day")}.`);
    if (items.length) out.push({ list: items });
  }
  if (x.inclusions?.length) out.push({ p: "Also included:" }, { list: x.inclusions });
  if (x.exclusions?.length) out.push({ p: "Not included:" }, { list: x.exclusions });

  // (f), (g): the total price, how anything unpriced is worked out, other costs.
  out.push({ h: "Price" });
  const vat = (o: OptionSummary) =>
    tax.vatRegistered ? `including VAT (${o.taxLabel ?? TAX_CODES[effectiveTaxCode(ctx.settings)].label})` : "no VAT: we're not VAT registered";
  if (options.length) {
    out.push({ facts: options.map((o): [string, string] => [o.label, `${money(o.totalPence)} in total, ${vat(o)}`]) });
  } else {
    out.push({ p: "The total price of each option, including any VAT, is on your proposal page." });
  }
  out.push({
    p: "The price is fixed for the work described. If we find something we couldn't have seen at the survey that changes the job, we'll explain it and give you the price in writing first. Nothing extra is charged unless you agree to it.",
  });
  if (x.assumptions?.length) out.push({ p: "The price assumes:" }, { list: x.assumptions });
  const fee = dateChangeFee();
  out.push({
    p: fee
      ? `There are no delivery charges. The only other cost you could face: if you move your install dates with less than ${fee.freeFromDays} days' notice, there's a ${money(fee.feePence)} date-change fee.`
      : "There are no delivery charges or other extra costs.",
  });

  // (j), (u): paying, deposits and timing.
  out.push({ h: "Paying and timing" });
  const methods = payments.methods.map((m) => PAYMENT_METHOD[m]);
  const pay: Para[] = [
    payments.depositPct > 0
      ? `A deposit of ${payments.depositPct}% of the price is due ${payments.depositTiming === "on-acceptance" ? "when you accept" : "before we order your equipment"}.`
      : "There's no deposit.",
    `We invoice the balance when the installation is finished. It's due within ${plural(payments.balanceDueDays, "day")} of the invoice.`,
  ];
  if (methods.length) pay.push(`You can pay by ${listJoin(methods).replace(/ and ([^,]+)$/, " or $1")}.`);
  // (j): the time by which we undertake to finish (else CRA s28's 30-day default would apply).
  pay.push(`${performanceCommitment(scheduling.installWithinWeeks)} You choose the dates after accepting, from the ones we can offer, at least ${INSTALL_LEAD_DAYS} days ahead.`);
  if (x.validUntil) pay.push(`This proposal is valid until ${dateLong(x.validUntil)}.`);
  out.push({ list: pay });

  // (l), (m), (n), (o): cancellation.
  out.push({ h: "Your right to cancel" });
  out.push({ p: x.cancellation });
  out.push({
    p: "To cancel, tell us with any clear statement: an email, a letter or a phone call. You can use the model form at the end of this email, but you don't have to. It's enough to send it before the period ends.",
  });
  out.push({
    p: "If you ask us to start work during the cancellation period and then cancel, you'll pay a proportionate amount for the work done up to when you tell us.",
  });
  out.push({
    p: supply
      ? "If you cancel after your equipment has been delivered, we collect it and we pay the cost of returning it."
      : "If you ask us to start during the cancellation period, you lose the right to cancel once we've fully completed the work.",
  });
  out.push({ p: "The full cancellation instructions and the model cancellation form are at the end of this email." });

  // (p), (q): conformity, guarantees and after-sales service.
  out.push({ h: "Guarantees and after-sales" });
  const g: Para[] = [];
  if (supply) g.push("We're under a legal duty to supply goods that conform with this contract.");
  if (x.guarantees?.length) {
    // Frozen with the proposal at issue: the same lines as its page and the contract.
    g.push(...x.guarantees, "After handover we check in, and you can report a problem any time from your project page or by phone.");
    out.push({ list: g });
  } else {
  const manufacturer = x.warranty?.trim() || warranty.manufacturerSummary?.trim();
  if (manufacturer) g.push(`Manufacturer's warranty: ${manufacturer}`);
  const years = warranty.workmanshipYears;
  if (years === 0) g.push("We don't offer a separate guarantee on our workmanship.");
  else if (years !== null && years > 0) {
    const terms = company.workmanshipGuarantee?.trim();
    g.push(`Our workmanship guarantee: ${plural(years, "year")}.${terms ? ` ${terms}` : ""}`);
  } else if (company.workmanshipGuarantee?.trim()) g.push(`Our workmanship guarantee: ${company.workmanshipGuarantee.trim()}`);
  g.push("After handover we check in, and you can report a problem any time from your project page or by phone.");
  g.push("None of this affects your legal rights.");
  out.push({ list: g });
  }

  // (k), (x): complaints and dispute resolution.
  const complaints = company.complaintsProcess.trim();
  const adr = company.adr?.trim();
  if (complaints || adr) {
    out.push({ h: "Complaints" });
    if (complaints) out.push({ p: complaints });
    if (adr) out.push({ p: `If you're not happy with how we've handled a complaint: ${adr}` });
  }
  return out;
}

/** Part A and Part B, as the closing section of a contract email. */
/** Our terms in full, as frozen on the proposal: the durable copy of the text that forms part of the contract. */
function termsAppendix(termsText: TermsSection[] | undefined, version: string | undefined): Block[] {
  if (!termsText?.length) return [];
  return [
    { h: `Our terms${version ? ` (version ${version})` : ""}` },
    { small: "These are the terms that apply to this proposal and, if you accept it, to your contract. Please keep this email." },
    ...termsText.flatMap((section, i): Block[] => [{ p: { strong: `${i + 1}. ${section.title}` } }, { list: section.items }]),
  ];
}

/** The template context with a proposal's frozen terms laid over today's settings (settingsForProposal). */
function asOffered(ctx: TemplateContext, terms: ProposalTerms | undefined): TemplateContext {
  return terms ? { ...ctx, settings: settingsForProposal(ctx.settings, { terms }) } : ctx;
}

function cancellationAppendix(ctx: TemplateContext, contractType: ContractType | undefined): Block[] {
  const trader = traderOf(ctx.settings);
  const opts = { contractType: contractType ?? "supply-and-install", days: ctx.settings.scheduling.cancellationDays } as const;
  return [
    { h: "Cancellation instructions" },
    ...cancellationInstructions(trader, opts).flatMap((para): Block[] =>
      para.heading ? [{ p: { strong: para.heading } }, { p: para.text }] : [{ p: para.text }],
    ),
    { h: "Model cancellation form" },
    { box: cancellationForm(trader) },
  ];
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

type Renderer<E extends CommsEventId> = (ctx: TemplateContext, data: CommsData[E]) => Draft;

/** Ends every text: our number, and the truth about replies. */
const smsTail = (ctx: TemplateContext) => `Questions? ${reach(ctx.settings, { capital: true })}. Texts to this number aren't read.`;
const smsHead = (ctx: TemplateContext) => `${ctx.settings.company.tradingName}:`;

const TEMPLATES: { [E in CommsEventId]: Renderer<E> } = {
  "magic-link": (ctx, d) => {
    const staff = d.audience === "staff";
    const mins = d.expiresInMinutes;
    const expiry =
      mins === undefined
        ? "It works once."
        : mins >= 60 * 24
          ? `It works once and lasts ${Math.round(mins / (60 * 24))} days.`
          : `It works once and expires in ${minutesPhrase(mins)}.`;
    return {
      subject: staff ? `Your ${ctx.settings.company.tradingName} sign-in link` : `Your link to your ${ctx.settings.company.tradingName} project`,
      body: [
        { p: staff ? "Here's your link to sign in to the team app." : "Here's your link to sign in and see your project." },
        { p: expiry },
      ],
      cta: "Sign in",
      after: [{ small: "If you didn't ask for this, you can ignore it: nobody can sign in without the link." }],
    };
  },

  "survey-booked": (ctx, d) => {
    const when = `${dayLong(d.scheduledFor)} at ${wallClock(d.scheduledFor)}`;
    const video = d.mode === "video";
    const who = d.surveyorName ? d.surveyorName : "One of our surveyors";
    const length = d.durationMinutes ? ` about ${minutesPhrase(d.durationMinutes)}` : "";
    return {
      subject: d.rescheduled
        ? `Your home survey has moved to ${shortDayTime(d.scheduledFor)}`
        : `Your home survey is booked: ${shortDayTime(d.scheduledFor)}`,
      body: [
        {
          p: [
            `Your ${video ? "video survey" : "home survey"} for ${place(ctx)} is ${d.rescheduled ? "now" : "booked"} for `,
            { strong: when },
            ".",
          ],
        },
        {
          p: video
            ? `${who} will spend${length} on a video call with you, going room by room and looking at where the units and pipes could go.`
            : `${who} will spend${length} measuring each room, looking at where the units and pipes could go, and checking your fuse board and outdoor space.`,
        },
        { p: "To help on the day:" },
        {
          list: [
            "Make sure we can get to your fuse board and, if you have one, the loft.",
            "Have a think about where you'd like the indoor units.",
            "If someone else needs to agree to the work (a co-owner or landlord), it helps if they can be there.",
          ],
        },
        ...(d.feeGbp && d.feeGbp > 0 ? [{ p: `The survey fee is ${money(d.feeGbp * 100)}.` } as Block] : []),
        {
          p: "What happens next: we design your system from what we measure, a qualified engineer checks the design, and we send you a proposal with a fixed price.",
        },
      ],
      cta: "See your survey details",
      after: [{ small: "Need a different time? You can move it from the same page, or call us." }],
    };
  },

  "survey-reminder": (ctx, d) => {
    const who = d.surveyorName ?? "Our surveyor";
    const video = d.mode === "video";
    return {
      subject: `Reminder: your ${video ? "video survey" : "home survey"} on ${shortDayTime(d.scheduledFor)}`,
      body: [
        {
          p: [
            `A reminder that your ${video ? "video survey" : "home survey"} for ${place(ctx)} is on `,
            { strong: `${dayLong(d.scheduledFor)} at ${wallClock(d.scheduledFor)}` },
            d.durationMinutes ? `. It takes about ${minutesPhrase(d.durationMinutes)}.` : ".",
          ],
        },
        {
          p: video
            ? `${who} will call you then. Have your phone charged and be ready to walk round each room.`
            : `${who} is coming to you. Please make sure we can get to your fuse board and loft.`,
        },
      ],
      cta: "See your survey details",
      sms: [
        `${smsHead(ctx)} Hi ${ctx.firstName}, a reminder that your ${video ? "video" : "home"} survey is on ${shortDayTime(d.scheduledFor)}${d.surveyorName ? ` with ${d.surveyorName}` : ""}.${video ? "" : " Please make sure we can reach your fuse board and loft."} To change it, ${reach(ctx.settings)}. Texts to this number aren't read.`,
        `${smsHead(ctx)} Hi ${ctx.firstName}, reminder: your survey is on ${shortDayTime(d.scheduledFor)}. To change it, ${reach(ctx.settings)}. Texts to this number aren't read.`,
        `${smsHead(ctx)} Survey reminder: ${shortDayTime(d.scheduledFor)}. ${reach(ctx.settings, { capital: true })} to change it. Texts aren't read.`,
      ],
    };
  },

  "surveyor-on-my-way": (ctx, d) => onMyWay(ctx, d, "survey"),

  "survey-complete": (ctx, d) => ({
    subject: "Thanks for having us: your survey is done",
    body: [
      { p: `Thanks for having us at ${place(ctx)}. Your survey is done.` },
      { p: "Here's what happens next:" },
      {
        list: [
          "We design your system around what we measured and the photos we took.",
          "A qualified engineer checks and signs off the design.",
          d.proposalBy
            ? `We send you a proposal with a fixed price. We aim to have it with you by ${dayLong(d.proposalBy)}.`
            : "We send you a proposal with a fixed price.",
        ],
      },
      d.needsDocumentsConsent
        ? {
            p: "One thing from you: we can only email your proposal and contract with your OK. If you're happy to get them by email, tick the box under Proposal on your project page. During the pilot we can't send them on paper, so if you'd rather not have them by email, reply to this email and we'll talk it through.",
          }
        : { p: "There's nothing you need to do until then." },
    ],
    cta: "Open your project",
  }),

  "proposal-issued": (live, d) => {
    // The proposal's frozen terms over today's settings, for everything below.
    const ctx = asOffered(live, d.terms);
    const options = d.optionCount && d.optionCount > 1 ? `, with ${d.optionCount} options to choose from` : "";
    return {
      subject: d.version > 1 ? `Your updated proposal is ready (version ${d.version})` : "Your proposal is ready",
      body: [
        { p: `Your ${d.version > 1 ? "updated " : ""}proposal for ${place(ctx)} is ready${options}.` },
        {
          p: `It shows the unit we've chosen for each room, where everything goes, how the pipes run, and a fixed price.${d.engineerApproved ? " A qualified engineer has checked and signed off the design." : ""}`,
        },
        { p: ["The price is valid until ", { strong: dateLong(d.validUntil) }, "."] },
        { p: "When you're ready, you can accept it, ask for changes or decline it, all from the same page. There's no obligation." },
        {
          p: "You agreed to get your documents by email, so this email is also your copy of the information you need before you decide, including your right to cancel. Please keep it.",
        },
      ],
      cta: "Review your proposal",
      after: [
        { h: "Before you decide: your pre-contract information" },
        ...preContractInfo(ctx, {
          ...d,
          validUntil: d.validUntil,
          cancellation: cancellationSentence({ accepted: false, contractType: d.contractType }, ctx.settings.scheduling.cancellationDays),
        }),
        ...cancellationAppendix(ctx, d.contractType),
        ...termsAppendix(d.termsText, d.termsVersion),
      ],
    };
  },

  "proposal-reminder": (ctx, d) => ({
    subject: `Your proposal is valid until ${shortDay(d.validUntil)}`,
    body: [
      { p: ["A quick note: your proposal for ", place(ctx), " is valid until ", { strong: dateLong(d.validUntil) }, "."] },
      {
        p: "If you'd like anything changed, use \"Ask for changes\" on the proposal page or call us. If it isn't for you, you can decline it there too, so we stop reminding you.",
      },
    ],
    cta: "Review your proposal",
  }),

  "proposal-accepted": (live, d) => {
    const ctx = asOffered(live, d.terms);
    const { company, legal, scheduling } = ctx.settings;
    const contractType = d.contractType ?? "supply-and-install";
    const supply = contractType !== "install-only";
    const accepted = london(d.acceptedAt);
    const summary: [string, string][] = [
      ["Property", place(ctx)],
      ["What you chose", d.optionLabel],
      ["Price", money(d.contractTotalPence)],
      ["VAT", vatLine(ctx.settings)],
      ["Contract", supply ? "Supply and installation" : "Installation only (you supply the equipment)"],
      ["Proposal", `Version ${d.version}${d.proposalRef ? ` (${d.proposalRef})` : ""}`],
    ];
    if (d.installDays) summary.push(["Installation", `${d.installDays} days, on dates you choose`]);
    summary.push(["Terms", d.termsVersion ?? legal.termsVersion]);

    const record: [string, string][] = [
      ["Accepted by", d.signedName?.trim() || ctx.customerName || "You"],
      ["When", `${dateLong(accepted.date)} at ${accepted.time} (UK time)`],
      ["Terms version", d.termsVersion ?? legal.termsVersion],
      ["Cancellation notice", d.cancellationNoticeVersion ?? CANCELLATION_NOTICE_VERSION],
      ["Documents by email", "Agreed"],
      ["Early start requested", d.earlyStartRequested ? "Yes" : "No"],
    ];

    const cancellation = cancellationSentence(
      { accepted: true, contractType, ...(d.cancellationEndsOn ? { endsOn: d.cancellationEndsOn } : {}) },
      scheduling.cancellationDays,
    );
    const wording = earlyStartWording(contractType);
    const wordingRef: Block = { small: `Wording reference: ${d.earlyStartWordingVersion ?? EARLY_START_WORDING_VERSION}.` };
    const reply = `reply to this email (or email ${company.email}) with these exact words:`;
    const startBlocks: Block[] = d.earlyStartRequested
      ? [
          { h: "You asked us to start sooner" },
          {
            p: `You ticked "start early" when you accepted. For that request to count, the law needs it from you in a form you can keep, such as an email. To confirm it, please ${reply}`,
          },
          { quote: wording },
          {
            p: "Until we have your reply, we can't start work before your cancellation period ends. You can still cancel during the period. If you cancel after work has started, you'll pay a proportionate amount for the work done up to when you tell us.",
          },
          ...(!supply && d.acknowledgedLossOfRight
            ? [{ p: "You also confirmed you understand that once the work is fully completed, you lose the right to cancel." } as Block]
            : []),
          wordingRef,
        ]
      : [
          { h: "When we can start" },
          {
            p: supply
              ? "We won't start the installation until your cancellation period has ended, unless you ask us to start sooner."
              : "We won't start work until your cancellation period has ended, unless you ask us to start sooner.",
          },
          { p: `If you'd like us to start sooner, ${reply}` },
          { quote: wording },
          wordingRef,
        ];

    const option: OptionSummary = d.option ?? {
      label: d.optionLabel,
      totalPence: d.contractTotalPence,
      ...(d.installDays ? { installDays: d.installDays } : {}),
    };
    return {
      subject: `Your contract with ${company.tradingName}: confirmation and cancellation rights`,
      body: [
        { p: `Thank you for accepting your proposal for ${place(ctx)}. This email confirms your contract with ${company.legalName} and is your copy of it. Please keep it.` },
        { h: "What you've agreed" },
        { facts: summary },
        { h: "Your acceptance record" },
        { facts: record },
        { h: "Your cancellation period" },
        { p: cancellation },
        ...startBlocks,
        { h: "What happens next" },
        {
          p: `Choose your install dates from your project page. We'll then confirm the dates and your team by email. Your proposal and your contract are in your documents there${d.termsText?.length ? ", and our terms are in full at the end of this email" : ""}.`,
        },
      ],
      cta: "Choose your install dates",
      after: [
        { h: "Your contract information" },
        ...preContractInfo(ctx, {
          contractType,
          options: [{ ...option, label: option.label || d.optionLabel, totalPence: d.contractTotalPence }],
          installDays: d.installDays,
          inclusions: d.inclusions,
          exclusions: d.exclusions,
          assumptions: d.assumptions,
          warranty: d.warranty,
          ...(d.guarantees ? { guarantees: d.guarantees } : {}),
          ...(d.terms ? { terms: d.terms } : {}),
          cancellation,
        }),
        ...cancellationAppendix(ctx, contractType),
        ...termsAppendix(d.termsText, d.termsVersion ?? legal.termsVersion),
      ],
    };
  },

  "proposal-changes-requested": (ctx, d) => ({
    subject: `Changes requested: ${ctx.customerName || "a customer"}${ctx.postcode ? ` (${ctx.postcode})` : ""}`,
    body: [
      {
        p: `${ctx.customerName || "The customer"} asked for changes to ${d.version ? `proposal version ${d.version}` : "their proposal"} for ${place(ctx)}:`,
      },
      { quote: d.text.trim() || "(no details given)" },
      {
        p: `Next: revise the design or proposal and issue a new version${ctx.customerPhone ? `, or call them on ${ctx.customerPhone}` : ""}.`,
      },
    ],
    cta: "Open the project",
  }),

  "invoice-issued": (ctx, d) => {
    const { payments, company } = ctx.settings;
    const due = d.outstandingPence ?? d.totalPence;
    const facts: [string, string][] = [
      ["Invoice", d.invoiceNumber],
      ["For", `${INVOICE_KIND[d.kind]}, ${place(ctx)}`],
      ["Amount", money(d.totalPence)],
    ];
    if (d.outstandingPence !== undefined && d.outstandingPence !== d.totalPence) {
      // Credit already on their account (a credit note, money overpaid) comes off: say so, so the two figures add up.
      if (d.outstandingPence < d.totalPence) facts.push(["Less: credit on your account", `−${money(d.totalPence - d.outstandingPence)}`]);
      facts.push(["Left to pay", money(d.outstandingPence)]);
    }
    if (d.dueOn) facts.push(["Due", dateLong(d.dueOn)]);
    facts.push(["VAT", vatLine(ctx.settings)]);

    const how: Block[] = [{ h: "How to pay" }];
    const ways: Para[] = [];
    const card = payments.methods.includes("card") && d.cardPayments !== false;
    if (card) ways.push("By card, on your project page (the button below).");
    if (payments.methods.includes("bank-transfer")) {
      ways.push(
        company.bank
          ? ["By bank transfer, using the reference ", { strong: d.invoiceNumber }, " so we can match it."]
          : "By bank transfer: call us for our bank details, and use the invoice number as the reference.",
      );
    }
    how.push(ways.length ? { list: ways } : { p: `${reach(ctx.settings, { capital: true, us: true })} to pay.` });
    if (payments.methods.includes("bank-transfer") && company.bank) {
      how.push({
        facts: [
          ["Account name", company.bank.accountName],
          ["Sort code", company.bank.sortCode],
          ["Account number", company.bank.accountNumber],
          ["Reference", d.invoiceNumber],
        ],
      });
    }
    return {
      subject: `Invoice ${d.invoiceNumber}: ${money(due)}${d.dueOn ? ` due ${shortDay(d.dueOn)}` : ""}`,
      body: [{ p: `Here's your ${INVOICE_KIND[d.kind]} invoice for ${place(ctx)}.` }, { facts }, ...how],
      cta: card ? "View and pay your invoice" : "View your invoice",
      after: [{ small: "We only ever mark an invoice paid once the payment has actually reached us." }],
    };
  },

  "payment-received": (ctx, d) => {
    const when = london(d.receivedAt).date;
    const left =
      d.outstandingPence === undefined
        ? null
        : d.outstandingPence > 0
          ? `The amount left to pay is ${money(d.outstandingPence)}.`
          : "You're all paid up: there's nothing more to pay right now.";
    return {
      subject: `Payment received: ${money(d.amountPence)}, thank you`,
      body: [
        {
          p: [
            "We've received your payment of ",
            { strong: money(d.amountPence) },
            `${d.invoiceNumber ? ` for invoice ${d.invoiceNumber}` : ""} on ${dateLong(when)}. Thank you.`,
          ],
        },
        ...(left ? [{ p: left } as Block] : []),
        { p: "Your receipt is on your project page." },
      ],
      cta: "See your receipt",
    };
  },

  "install-booked": (ctx, d) => {
    const dates = [...d.dates].sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const range = !first ? "" : first === last ? shortDay(first) : `${shortDay(first)} to ${shortDay(last)}`;
    const crew = (d.crew ?? []).map((c): Para => [{ strong: c.name }, `, ${ROLE_LABEL[c.role]?.toLowerCase() ?? "installer"}`]);
    return {
      subject: d.moved ? `Your install dates have changed: ${range}` : `Your install is booked: ${range}`,
      body: [
        {
          p: `Your installation at ${place(ctx)} is ${d.moved ? "now" : "confirmed"} for ${dates.length} day${dates.length === 1 ? "" : "s"}:`,
        },
        { list: dates.map((x) => dayLong(x)) },
        ...(crew.length ? [{ p: "Your team:" } as Block, { list: crew } as Block] : []),
        ...(d.prep && d.prep.length
          ? [{ p: "Before day 1, it helps if you can:" } as Block, { list: d.prep } as Block]
          : []),
        {
          p:
            ctx.onTheWay === "sms"
              ? "We'll email you a few days before, text you the evening before, and text again when the team is on the way."
              : ctx.onTheWay === "email"
                ? "We'll email you a few days before, again the evening before, and when the team is on the way."
                : "We'll email you a few days before with everything you need for day 1.",
        },
      ],
      cta: "See your install plan",
      after: d.moved ? [{ small: "If the new dates don't work for you, call us and we'll sort it out." }] : undefined,
    };
  },

  "kit-update": (ctx, d) => {
    const toCome =
      d.shortages && d.shortages > 0
        ? `${d.shortages} item${d.shortages === 1 ? " is" : "s are"} still to come. We're chasing ${d.shortages === 1 ? "it" : "them"} and will tell you straight away if it affects your dates.`
        : null;
    const head =
      d.status === "confirmed"
        ? {
            subject: "Your equipment is confirmed by the supplier",
            p: `The supplier has confirmed the equipment for ${place(ctx)}${d.expectedDate ? `, due ${dayLong(d.expectedDate)}` : ""}.`,
          }
        : d.status === "delivered"
          ? { subject: "Your equipment has been delivered", p: `The equipment for ${place(ctx)} has been delivered.` }
          : {
              subject: "Your equipment has been checked",
              // Whoever did it (office or crew): the same honest wording as the portal and the timeline.
              p: `Our team has checked the equipment for ${place(ctx)} against the design.`,
            };
    return {
      subject: head.subject,
      body: [{ p: head.p }, ...(toCome ? [{ p: toCome } as Block] : []), { p: "Nothing for you to do: we'll keep you posted on your project page." }],
      cta: "See your project",
    };
  },

  "install-prep": (ctx, d) => ({
    subject: `Getting ready for your install on ${shortDay(d.startDate)}`,
    body: [
      { p: ["Your installation at ", place(ctx), " starts on ", { strong: dayLong(d.startDate) }, "."] },
      ...(d.prep && d.prep.length ? [{ p: "A few things that help:" } as Block, { list: d.prep } as Block] : []),
      {
        p: "Power: we'll need to switch your electricity off for about 30 minutes while we connect the system. We'll tell you before we do it.",
      },
    ],
    cta: "Tick off your checklist",
  }),

  "install-day-before": (ctx, d) => {
    const names = listJoin(d.crewNames ?? []);
    const who = names || "Your installation team";
    const arrival = d.arrival ? ` around ${d.arrival}` : "";
    return {
      subject: `Your install starts ${shortDay(d.startDate)}`,
      body: [
        { p: [`${who} will arrive at ${place(ctx)} on `, { strong: `${dayLong(d.startDate)}${arrival}` }, "."] },
        ...(d.parkingNotes ? [{ p: `Parking: ${d.parkingNotes}` } as Block] : []),
        ...(onTheWayLine(ctx.onTheWay, "they're") ? [{ p: onTheWayLine(ctx.onTheWay, "they're") } as Block] : []),
      ],
      cta: "See your install plan",
      sms: [
        `${smsHead(ctx)} Hi ${ctx.firstName}, your install at ${ctx.addressLine || "your home"} starts ${shortDay(d.startDate)}${arrival}${names ? ` with ${names}` : ""}. We'll text when the team is on the way. ${smsTail(ctx)}`,
        `${smsHead(ctx)} Hi ${ctx.firstName}, your install starts ${shortDay(d.startDate)}${arrival}. We'll text when the team is on the way. ${smsTail(ctx)}`,
        `${smsHead(ctx)} Your install starts ${shortDay(d.startDate)}. ${smsTail(ctx)}`,
      ],
    };
  },

  "installer-on-my-way": (ctx, d) => onMyWay(ctx, d, "install"),

  "install-day-update": (ctx, d) => {
    const of = d.totalDays ? ` of ${d.totalDays}` : "";
    const last = d.totalDays !== undefined && d.n >= d.totalDays;
    const next = d.complete
      ? d.complete.handoverPack
        ? "Your system is installed and commissioned, and your handover pack is on your project page."
        : "Your system is installed and commissioned. Your handover pack will be on your project page shortly."
      : last
      ? "That's the last planned day. Next, we commission the system and walk you through it before we hand over."
      : d.nextDate
        ? `The team is back on ${dayLong(d.nextDate)}.`
        : "The team will be back for the next day as planned.";
    return {
      subject: `Your install: day ${d.n}${of} done`,
      body: [
        { p: `Here's today's update from ${d.by ?? "your installer"} at ${place(ctx)}:` },
        { quote: d.text.trim() || `Day ${d.n} done.` },
        ...(d.photoCount && d.photoCount > 0
          ? [{ p: `There ${d.photoCount === 1 ? "is 1 photo" : `are ${d.photoCount} photos`} from today on your project page.` } as Block]
          : []),
        { p: next },
      ],
      cta: d.photoCount && d.photoCount > 0 ? "See today's photos" : "Open your project",
    };
  },

  "variation-approval": (ctx, d) => {
    const delta = d.totalDeltaPence;
    const price =
      delta > 0 ? `adds ${money(delta)} to your price` : delta < 0 ? `takes ${money(-delta)} off your price` : "doesn't change your price";
    return {
      subject: "A change to your installation needs your OK",
      body: [
        { p: `While working at ${place(ctx)}, we found something that changes the job:` },
        { p: { strong: d.title } },
        ...(d.description ? [{ quote: d.description } as Block] : []),
        { p: `This change ${price}.` },
        { p: "Nothing changes until you say yes. You can approve or decline it on your project page, or call us to talk it through." },
      ],
      cta: "Review the change",
      sms: [
        `${smsHead(ctx)} Hi ${ctx.firstName}, a change to your install needs your OK before we go ahead. We've emailed you the details. ${smsTail(ctx)}`,
        `${smsHead(ctx)} A change to your install needs your OK. Details by email. ${smsTail(ctx)}`,
      ],
    };
  },

  // The customer's durable copy of extra work they agreed to pay for.
  "variation-accepted": (ctx, d) => {
    const { settings } = ctx;
    const delta = d.totalDeltaPence;
    const vat = settings.tax.vatRegistered;
    return {
      subject: `You agreed a change to your installation${d.issueNumber ? ` (change #${d.issueNumber})` : ""}`,
      body: [
        { p: `Thanks ${ctx.firstName}. This is your copy of the change you agreed to for the work at ${place(ctx)}. Please keep this email.` },
        { p: { strong: d.title } },
        ...(d.description ? [{ quote: d.description } as Block] : []),
        {
          facts: [
            ...(vat ? ([["Price change before VAT", money(d.priceDeltaNetPence)], ["VAT", money(d.taxPence)]] as [string, string][]) : []),
            ["Total price change", `${delta > 0 ? "+" : ""}${money(delta)}${vat ? "" : " (no VAT: we're not VAT registered)"}`],
            ...(d.newContractTotalPence !== undefined ? ([["Your new contract total", money(d.newContractTotalPence)]] as [string, string][]) : []),
            ["Agreed by", d.name],
            ["When", fmtDayTime(d.acceptedAt)],
            ["What you agreed to", `"${d.wording}"`],
          ],
        },
        {
          p: delta > 0
            ? "It's added to your contract and paid with your balance (or invoiced on its own), on the same payment terms."
            : "It's part of your contract now, on the same terms.",
        },
        {
          p: `Changed your mind? Tell us before we start this extra work and we won't do it: reply to this email${settings.company.phone && !isPlaceholderPhone(settings.company.phone) ? ` or call ${settings.company.phone}` : ""}. Your cancellation rights on the contract itself are unchanged.`,
        },
      ],
      cta: "See the change in your documents",
    };
  },

  // The acknowledgement of a cancellation: a durable record of when it reached us and what happens next.
  // After the period ended (`withinPeriod` false) it only acknowledges: no refund or collection is promised
  // in writing before anyone has checked what the contract allows (cancellation-server raises that review).
  "cancellation-confirmed": (ctx, d) => {
    const how = d.channel ? ` (by ${d.channel === "in-person" ? "telling us in person" : d.channel})` : "";
    const on = dayLong(d.receivedAt.slice(0, 10));
    if (d.withinPeriod === false) {
      return {
        subject: "We've received your cancellation",
        body: [
          { p: `Thanks for letting us know. We received your message cancelling your contract for the work at ${place(ctx)} on ${on}${how}.` },
          {
            p: "It reached us after your cancellation period had ended, so we're checking what that means for your contract, including anything you've paid and any equipment we've supplied. We'll be in touch in writing to explain what happens next.",
          },
          { p: `Any questions in the meantime, ${reach(ctx.settings)}.` },
        ],
        cta: "Open your project",
      };
    }
    return {
      subject: "We've received your cancellation",
      body: [
        { p: `Thanks for letting us know. We received your cancellation on ${on}${how}, and your contract for the work at ${place(ctx)} is cancelled.` },
        {
          p: d.paidPence > 0
            ? `We'll refund the ${money(d.paidPence)} you've paid by ${dayLong(d.refundDueBy)} at the latest, the same way you paid. If you'd asked us to start early and work was done, we'll explain any deduction for that work in writing first.`
            : d.workStartedEarly
              ? "You haven't paid us anything, so there's nothing to refund. You asked us to start before your cancellation period ended and work was done, so we'll write to you about any amount for that work."
              : "You haven't paid us anything, so there's nothing to refund, and nothing more is due.",
        },
        ...(d.collectEquipment ? [{ p: "We'll collect the equipment we supplied, at our cost. We'll be in touch to agree a time." } as Block] : []),
        { p: `Any questions, ${reach(ctx.settings)}.` },
      ],
      cta: "Open your project",
    };
  },

  "issue-update": (ctx, d) => ({
    subject: `Update: ${d.title}`,
    body: [
      { p: `An update on ${d.issueNumber ? `issue ${d.issueNumber}, ` : ""}"${d.title}", at ${place(ctx)}:` },
      { quote: d.update.trim() || "We're looking into it." },
      ...(d.nextStep ? [{ p: `What happens next: ${d.nextStep}` } as Block] : []),
      ...(d.dueOn ? [{ p: `When: ${dayLong(d.dueOn)}.` } as Block] : []),
    ],
    cta: "Open your project",
  }),

  "handover-ready": (ctx, d) => {
    const { warranty } = ctx.settings;
    const contents: Para[] = [
      "the equipment in each room, with model and serial numbers",
      "your commissioning record",
      "how to use and look after your system",
    ];
    if (warranty.workmanshipYears || warranty.manufacturerSummary) contents.push("your warranty details");
    return {
      subject: "Your handover pack is ready",
      body: [
        { p: `Your system at ${place(ctx)} has been commissioned, and your handover pack is ready. It includes:` },
        { list: contents },
        ...(d.electricalCertPending
          ? [
              {
                p: "Your electrical certificate comes from the electrician's registration scheme and can take a few weeks. We'll add it to your pack and tell you when it's there.",
              } as Block,
            ]
          : []),
      ],
      cta: "Open your handover pack",
    };
  },

  "certificate-issued": (ctx, d) => {
    const electrical = d.kind === "electrical-certificate";
    return {
      subject: electrical ? "Your electrical certificate is in your documents" : "Your manufacturer warranty is registered",
      body: [
        {
          p: electrical
            ? `The electrical installation certificate for the work at ${place(ctx)} has arrived. It's now in your documents on your project page, beside your handover pack.`
            : `We've registered the manufacturer's warranty for your system at ${place(ctx)}. The registration and its reference are in your documents on your project page.`,
        },
        {
          p: electrical
            ? "Keep it with your home's paperwork: you may be asked for it if you sell the house."
            : "Keep it with your home's paperwork: you'll need it for any warranty claim.",
        },
        { p: "Nothing for you to do." },
      ],
      cta: "See your documents",
    };
  },

  "check-in-7d": (ctx) => ({
    subject: "How's your system running?",
    body: [
      { p: `It's been a week since we finished at ${place(ctx)}. We hope it's running well.` },
      {
        p: "If anything isn't right, like a noise, a drip, or a room that isn't getting warm or cool enough, tell us on your project page and we'll sort it.",
      },
    ],
    cta: "Tell us how it's going",
  }),

  "feedback-30d": (ctx) => ({
    subject: "One month on: how did we do?",
    body: [
      { p: `It's been a month since your installation at ${place(ctx)}.` },
      { p: "Would you give us a score from 0 to 10, and tell us what we could do better? It takes about a minute, and we read every answer." },
      { p: "We ask everyone this at the same point. It's just for us: it isn't a public review, and your answer doesn't change anything else we send you." },
    ],
    cta: "Give your score",
  }),

  // The same words for everyone, at the same point, whatever their score:
  // no gating, no incentive (DMCC Act 2024 Sch 20 para 13).
  "review-request": (ctx) => {
    const url = ctx.settings.company.reviewUrl;
    return {
      subject: `Would you review ${ctx.settings.company.tradingName}?`,
      body: [
        {
          p: `It's been a while since we finished at ${place(ctx)}, so we're asking what we ask every customer at this point: would you write an honest review of us?`,
        },
        {
          p: "Good, bad or in between, we'd like it said. There's no reward, discount or prize for a review, and the review site publishes it, not us.",
        },
        { p: "Separately, if anything isn't working as it should, tell us on your project page or call us, review or no review." },
      ],
      ...(url ? { cta: "Write a review", ctaHref: url } : { cta: "Open your project" }),
    };
  },

  "seasonal-check": (ctx, d) => {
    const heating = d.mode === "heating";
    return {
      subject: heating ? "Colder days ahead: using your system to heat" : "Warmer days ahead: using your system to cool",
      body: [
        {
          p: heating
            ? `As the weather turns colder, you'll probably use the system at ${place(ctx)} to heat your home for the first time.`
            : `As the weather warms up, you'll probably use the system at ${place(ctx)} to cool your home for the first time.`,
        },
        { p: "A few things that help:" },
        {
          list: heating
            ? [
                "Switch the mode to Heat on the remote or the app.",
                "Pick a steady temperature and leave it there: that's more efficient than turning it up and down.",
                "In cold, damp weather the outdoor unit defrosts now and then. A puff of steam and a short pause in the warm air are normal.",
                "Clean the filters as the manual says, so it keeps running well.",
              ]
            : [
                "Switch the mode to Cool on the remote or the app.",
                "Set it a few degrees below the room, not as low as it goes, and close curtains on the sunny side on hot days.",
                "A little water from the condensate pipe outside is normal.",
                "Clean the filters as the manual says, so it keeps running well.",
              ],
        },
        { p: "If anything doesn't seem right, tell us on your project page and we'll sort it." },
      ],
      cta: "Report a problem or ask a question",
    };
  },

  // Operational: the due date and the warranty condition, for everyone. Offering
  // to do it (a paid service) is marketing, so that line needs their consent.
  "service-reminder": (ctx, d) => ({
    subject: `Your system's yearly service is due ${shortDay(d.dueOn)}`,
    body: [
      { p: ["Your system at ", place(ctx), " is due its yearly service around ", { strong: dateLong(d.dueOn) }, "."] },
      {
        p: "Manufacturer warranties often require a yearly service by an F-gas certified engineer, and it keeps the system running efficiently. Your handover pack has the details for your model.",
      },
      ...(ctx.marketingConsent ? [{ p: `We can do it for you: to book, ${reach(ctx.settings, { us: false })}.` } as Block] : []),
    ],
    cta: "Open your project",
  }),

  "team-alert": (ctx, d) => {
    const lines = [...(d.lines ?? [])];
    const { legal } = ctx.settings;
    if (d.legalCheck && !legal.cancellationReviewed) lines.push("Cancellation wording is not yet marked reviewed in settings (legal).");
    if (d.legalCheck && !legal.termsReviewed) lines.push(`Terms ${legal.termsVersion} are not yet marked reviewed in settings (legal).`);
    const missing = d.legalCheck ? schedule2Missing(ctx.settings) : [];
    if (missing.length) {
      lines.push(`Pre-contract information incomplete in settings: ${missing.join(", ")}. The cancellation information and form need our geographical address.`);
    }
    return {
      subject: `${d.urgent ? "[Urgent] " : ""}${d.title}`,
      body: [
        ...(ctx.customerName || ctx.addressLine
          ? [{ p: { strong: [ctx.customerName, place(ctx)].filter(Boolean).join(", ") } } as Block]
          : []),
        ...(d.detail ? [{ p: d.detail } as Block] : []),
        ...(lines.length ? [{ list: lines } as Block] : []),
      ],
      cta: "Open in ops",
    };
  },
};

/** Survey and install share the on-my-way shape: an SMS, with a matching email-shaped body for the log. */
function onMyWay(ctx: TemplateContext, d: { etaMinutes: number; at: string; name?: string }, kind: "survey" | "install"): Draft {
  const who = d.name?.trim() || (kind === "survey" ? "Your surveyor" : "Your installer");
  const at = arrivalTime(d.at, d.etaMinutes);
  const eta = Math.max(1, Math.round(d.etaMinutes));
  const arriving = at ? `around ${at} (about ${eta} min)` : `in about ${eta} min`;
  const what = kind === "survey" ? "your home survey" : "your install";
  const line = `${who} is on the way to ${what} and should arrive ${arriving}.`;
  return {
    subject: kind === "survey" ? "Your surveyor is on the way" : "Your installer is on the way",
    body: [{ p: line }],
    sms: [
      `${smsHead(ctx)} Hi ${ctx.firstName}, ${line} ${smsTail(ctx)}`,
      `${smsHead(ctx)} ${line} ${smsTail(ctx)}`,
      `${smsHead(ctx)} We're on the way, arriving ${arriving}. ${reach(ctx.settings, { capital: true })}. Texts aren't read.`,
    ],
  };
}

/**
 * Render one event. Typed per event, so a caller can't forget a field the
 * copy depends on; every optional field degrades to a sentence without it.
 */
export function renderMessage<E extends CommsEventId>(event: E, ctx: TemplateContext, data: CommsData[E]): RenderedMessage {
  const renderer = TEMPLATES[event] as Renderer<E>;
  return wrap(event, ctx, renderer(ctx, data));
}

/** The SMS texts a template offers, longest first, exactly as written (before fitting), for tests. */
export function smsCandidates<E extends CommsEventId>(event: E, ctx: TemplateContext, data: CommsData[E]): string[] {
  if (!COMMS_EVENTS[event].channels.includes("sms")) return [];
  return (TEMPLATES[event] as Renderer<E>)(ctx, data).sms ?? [];
}
