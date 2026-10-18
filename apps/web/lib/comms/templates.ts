import {
  COMMS_EVENTS,
  ROLE_LABEL,
  TAX_CODES,
  effectiveTaxCode,
  type CommsEventId,
  type InvoiceKind,
  type Payment,
  type PilotSettings,
  type StaffRole,
} from "@aircon/domain";
import { brandedEmail, escapeHtml } from "../email.ts";
import { fmtDate, fmtDay, fmtDayTime, money } from "../format.ts";
import { fitSms } from "../providers/sms.ts";
import { CANCELLATION_NOTICE_VERSION, cancellationForm, cancellationInstructions } from "./legal-text.ts";

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
 * phone number and says replies aren't read. Two segments at most; each
 * template offers shorter fallbacks for long names and addresses.
 *
 * Pure (no I/O, no clock): `node --test` renders every event directly.
 */

/* ------------------------------------------------------------------ */
/* Event data                                                          */
/* ------------------------------------------------------------------ */

type EmptyData = Record<string, never>;

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
  "survey-complete": { proposalBy?: string };
  "proposal-issued": { version: number; validUntil: string; optionCount?: number; engineerApproved?: boolean };
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
  };
  "proposal-changes-requested": { text: string; version?: number };
  "invoice-issued": {
    invoiceNumber: string;
    kind: InvoiceKind;
    totalPence: number;
    outstandingPence?: number;
    dueOn?: string;
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
  "install-day-update": { n: number; totalDays?: number; text: string; photoCount?: number; nextDate?: string; by?: string };
  "variation-approval": { title: string; description?: string; totalDeltaPence: number; issueNumber?: number };
  "issue-update": { title: string; update: string; nextStep?: string; dueOn?: string; issueNumber?: number };
  "handover-ready": { electricalCertPending?: boolean };
  "check-in-7d": EmptyData;
  "feedback-30d": EmptyData;
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
  "issue-update": "",
  "handover-ready": "#handover",
  "check-in-7d": "#aftercare",
  "feedback-30d": "#aftercare",
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
  if ("small" in b) return `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#6e7482">${paraHtml(b.small)}</p>`;
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
          `<tr><td style="padding:7px 12px 7px 0;border-bottom:1px solid #ece6da;color:#6e7482;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:7px 0;border-bottom:1px solid #ece6da;font-weight:600">${multiline(v)}</td></tr>`,
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
  `<p style="margin:4px 0 24px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#d55a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">${escapeHtml(label)}</a></p>`;

/** What a template returns; `wrap` adds the greeting, the button, the sign-off and support details. */
interface Draft {
  subject: string;
  body: Block[];
  cta?: string;
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
  if (d.cta && ctx.portalUrl) {
    html.push(buttonHtml(d.cta, ctx.portalUrl));
    text.push(`${d.cta}: ${ctx.portalUrl}`);
  }

  const tail: Block[] = [...(d.after ?? [])];
  if (team) {
    tail.push({ small: `Team alert from the ${company.tradingName} platform.` });
  } else {
    tail.push({ p: `Thanks,\nThe ${company.tradingName} team` });
    tail.push({ small: `Questions? Call us on ${company.phone} or email ${company.email}.` });
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
  if (d.sms && COMMS_EVENTS[event].channels.includes("sms")) out.sms = fitSms(d.sms);
  return out;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

type Renderer<E extends CommsEventId> = (ctx: TemplateContext, data: CommsData[E]) => Draft;

/** Ends every text: our number, and the truth about replies. */
const smsTail = (ctx: TemplateContext) => `Questions? Call ${ctx.settings.company.phone}. Texts to this number aren't read.`;
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
        `${smsHead(ctx)} Hi ${ctx.firstName}, a reminder that your ${video ? "video" : "home"} survey is on ${shortDayTime(d.scheduledFor)}${d.surveyorName ? ` with ${d.surveyorName}` : ""}.${video ? "" : " Please make sure we can reach your fuse board and loft."} To change it, call ${ctx.settings.company.phone}. Texts to this number aren't read.`,
        `${smsHead(ctx)} Hi ${ctx.firstName}, reminder: your survey is on ${shortDayTime(d.scheduledFor)}. To change it, call ${ctx.settings.company.phone}. Texts to this number aren't read.`,
        `${smsHead(ctx)} Survey reminder: ${shortDayTime(d.scheduledFor)}. Call ${ctx.settings.company.phone} to change it. Texts aren't read.`,
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
      { p: "There's nothing you need to do until then." },
    ],
    cta: "Open your project",
  }),

  "proposal-issued": (ctx, d) => {
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
      ],
      cta: "Review your proposal",
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

  "proposal-accepted": (ctx, d) => {
    const { company, legal } = ctx.settings;
    const trader = {
      legalName: company.legalName,
      tradingName: company.tradingName,
      registeredAddress: company.registeredAddress,
      phone: company.phone,
      email: company.email,
    };
    const accepted = london(d.acceptedAt);
    const summary: [string, string][] = [
      ["Property", place(ctx)],
      ["What you chose", d.optionLabel],
      ["Price", money(d.contractTotalPence)],
      ["VAT", vatLine(ctx.settings)],
      ["Proposal", `Version ${d.version}${d.proposalRef ? ` (${d.proposalRef})` : ""}`],
    ];
    if (d.installDays) summary.push(["Installation", `${d.installDays} days, on dates you choose`]);
    summary.push(["Terms", d.termsVersion ?? legal.termsVersion]);

    const record: [string, string][] = [
      ["Accepted by", d.signedName?.trim() || ctx.customerName || "You"],
      ["When", `${dateLong(accepted.date)} at ${accepted.time} (UK time)`],
      ["Terms version", d.termsVersion ?? legal.termsVersion],
      ["Cancellation notice", d.cancellationNoticeVersion ?? CANCELLATION_NOTICE_VERSION],
      ["Early start requested", d.earlyStartRequested ? "Yes" : "No"],
    ];

    const ends = d.cancellationEndsOn ? dateLong(d.cancellationEndsOn) : null;
    const startBlocks: Block[] = d.earlyStartRequested
      ? [
          { h: "You asked us to start within 14 days" },
          {
            p: "You asked us to start work during your cancellation period, and we've recorded that request. You can still cancel during the period. If you cancel after work has started, you'll pay a proportionate amount for the work done up to when you tell us.",
          },
          ...(d.acknowledgedLossOfRight
            ? [{ p: "You also confirmed you understand that once the work is fully completed, you lose the right to cancel." } as Block]
            : []),
        ]
      : [
          { h: "When we can start" },
          {
            p: ends
              ? `Your cancellation period ends at the end of ${ends}. We won't start work until it has ended, unless you ask us to start sooner.`
              : "We won't start work until your 14-day cancellation period has ended, unless you ask us to start sooner.",
          },
        ];

    return {
      subject: `Your contract with ${company.tradingName}: confirmation and cancellation rights`,
      body: [
        { p: `Thank you for accepting your proposal for ${place(ctx)}. This email confirms your contract with ${company.legalName}. Please keep it.` },
        { h: "What you've agreed" },
        { facts: summary },
        { h: "Your acceptance record" },
        { facts: record },
        ...startBlocks,
        { h: "What happens next" },
        { p: "Choose your install dates from your project page. We'll then confirm the dates and your team by email. Your proposal and terms are on the same page." },
      ],
      cta: "Choose your install dates",
      after: [
        { h: "Your right to cancel" },
        ...cancellationInstructions(trader).flatMap((para): Block[] =>
          para.heading ? [{ p: { strong: para.heading } }, { p: para.text }] : [{ p: para.text }],
        ),
        { h: "Model cancellation form" },
        { box: cancellationForm(trader) },
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
    if (d.outstandingPence !== undefined && d.outstandingPence !== d.totalPence) facts.push(["Left to pay", money(d.outstandingPence)]);
    if (d.dueOn) facts.push(["Due", dateLong(d.dueOn)]);
    facts.push(["VAT", vatLine(ctx.settings)]);

    const how: Block[] = [{ h: "How to pay" }];
    const ways: Para[] = [];
    if (payments.methods.includes("card")) ways.push("By card, on your project page (the button below).");
    if (payments.methods.includes("bank-transfer")) {
      ways.push(
        company.bank
          ? ["By bank transfer, using the reference ", { strong: d.invoiceNumber }, " so we can match it."]
          : "By bank transfer: call us for our bank details, and use the invoice number as the reference.",
      );
    }
    how.push(ways.length ? { list: ways } : { p: `Call us on ${company.phone} to pay.` });
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
      cta: payments.methods.includes("card") ? "View and pay your invoice" : "View your invoice",
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
          p: ctx.customerPhone
            ? "We'll email you a few days before, text you the evening before, and text again when the team is on the way."
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
              p: `Your installer has checked the equipment for ${place(ctx)} against the design.`,
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
        { p: "We'll text you when they're on the way." },
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
    const next = last
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
    ],
    cta: "Give your score",
  }),

  "service-reminder": (ctx, d) => ({
    subject: `Your system's yearly service is due ${shortDay(d.dueOn)}`,
    body: [
      { p: ["Your system at ", place(ctx), " is due its yearly service around ", { strong: dateLong(d.dueOn) }, "."] },
      { p: "A yearly service keeps it running efficiently, and manufacturer warranties often require one." },
      { p: `To book it, call us on ${ctx.settings.company.phone}.` },
    ],
    cta: "Open your project",
  }),

  "team-alert": (ctx, d) => {
    const lines = [...(d.lines ?? [])];
    const { legal } = ctx.settings;
    if (d.legalCheck && !legal.cancellationReviewed) lines.push("Cancellation wording is not yet marked reviewed in settings (legal).");
    if (d.legalCheck && !legal.termsReviewed) lines.push(`Terms ${legal.termsVersion} are not yet marked reviewed in settings (legal).`);
    if (d.legalCheck && !ctx.settings.company.registeredAddress?.trim()) {
      lines.push("No company address in settings: the cancellation information and form need our geographical address.");
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
      `${smsHead(ctx)} We're on the way, arriving ${arriving}. Call ${ctx.settings.company.phone}. Texts aren't read.`,
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
