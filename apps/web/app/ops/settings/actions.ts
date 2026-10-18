"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TAX_CODES, mergeSettings, schedule2Missing, type PilotSettings, type TaxCodeId } from "@aircon/domain";
import { done, refused, type ActionResult } from "@/components/ops/command/types";
import { requireStaff } from "@/lib/auth/server";
import * as settingsRepo from "@/lib/repo/settings";
import { saveSettings } from "@/lib/settings-server";

/**
 * Save the whole settings document (admin only; saveSettings audits which
 * sections changed). Validated field by field here, then merged over the
 * defaults, so nothing malformed is stored. Refuses to overwrite a newer
 * save by someone else.
 */

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
const money = z.number().int().min(0).max(100_000_000);
const pct = z.number().min(0).max(100);
const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional();
const TAX = Object.keys(TAX_CODES) as [TaxCodeId, ...TaxCodeId[]];

const schema = z.object({
  company: z.object({
    legalName: text(160).min(2, "Enter the company's legal name"),
    tradingName: text(160),
    companyNumber: optText(20),
    registeredAddress: optText(300),
    geographicAddress: text(300),
    phone: text(30),
    email: z.union([z.string().trim().email("The company email doesn't look right").max(200), z.literal("")]),
    complaintsProcess: text(2000),
    adr: optText(1000),
    workmanshipGuarantee: optText(2000),
    reviewUrl: z.union([z.string().trim().url("The review link must be a full web address (https://…)").max(400), z.literal("")]).optional(),
    vatNumber: optText(20),
    fgasCompanyCert: z.object({ body: text(120), number: text(60), expiresOn: date }).optional(),
    insurance: z.object({ provider: text(120), policy: text(60), expiresOn: date }).optional(),
    bank: z
      .object({
        accountName: text(120),
        sortCode: z.union([z.string().trim().regex(/^\d{2}-?\d{2}-?\d{2}$/, "Sort code: six digits, like 12-34-56"), z.literal("")]),
        accountNumber: z.union([z.string().trim().regex(/^\d{8}$/, "Account number: eight digits"), z.literal("")]),
      })
      .optional(),
  }),
  tax: z.object({ vatRegistered: z.boolean(), defaultTaxCode: z.enum(TAX), accountantConfirmed: z.boolean(), rationale: text(1000) }),
  pricing: z.object({
    minMarginPct: pct,
    contingencyPct: pct,
    overheadPerJobPence: money,
    quoteValidityDays: z.number().int().min(1, "Quotes must be valid for at least a day").max(365),
    requireEngineerSignoff: z.boolean(),
    labourRates: z.object({ installerDayPence: money, electricianDayPence: money, techLeadDayPence: money, surveyorHourPence: money }),
    premiumUpliftPct: pct,
  }),
  discounts: z
    .array(
      z.object({
        code: z.string().trim().regex(/^[A-Z0-9_-]{2,30}$/, "Discount codes: capitals, digits, - or _"),
        label: text(80).min(1, "Every discount needs a label"),
        pct: pct.optional(),
        amountPence: money.optional(),
        reason: text(200),
        active: z.boolean(),
      }),
    )
    .max(30),
  payments: z.object({
    depositPct: pct,
    depositTiming: z.enum(["on-acceptance", "before-kit-order"]),
    balanceDueDays: z.number().int().min(0).max(90),
    methods: z.array(z.enum(["card", "bank-transfer"])).min(1, "Offer at least one way to pay"),
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "Invoice prefix: up to 8 capitals or digits"),
    nextInvoiceNumber: z.number().int().min(1).max(999_999),
  }),
  scheduling: z.object({
    installBlockDays: z.number().int().min(1).max(10),
    surveySlotTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Survey slots are times like 10:00")).min(1, "Add at least one survey slot time").max(12),
    surveyDurationMinutes: z.number().int().min(15).max(480),
    surveyFeeGbp: z.number().int().min(0).max(1000),
    cancellationDays: z.number().int().min(14, "The cancellation period can't be shorter than the statutory 14 days").max(60),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one working day"),
  }),
  serviceArea: z.object({ outcodes: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}\d[A-Z\d]?$/, "Outcodes look like SW16 or CR0")).max(400) }),
  sla: z.object({ enabled: z.boolean() }),
  warranty: z.object({ workmanshipYears: z.number().int().min(0).max(25).nullable(), manufacturerSummary: z.string().trim().max(1000).nullable() }),
  legal: z.object({ termsVersion: text(40).min(1, "Name the terms version"), termsReviewed: z.boolean(), cancellationReviewed: z.boolean() }),
  comms: z.object({ smsSenderId: z.string().trim().regex(/^[A-Za-z0-9 ]{1,11}$/, "SMS sender: up to 11 letters or digits"), disabledEvents: z.array(z.string()).max(50) }),
  finance: z.object({ lenderConfigured: z.boolean() }),
  features: z.object({ showPrototypeNav: z.boolean() }),
});

/** Optional nested groups left entirely blank are dropped rather than stored empty. */
function tidy(s: z.infer<typeof schema>): PilotSettings {
  const c = { ...s.company } as Record<string, unknown>;
  for (const k of ["companyNumber", "registeredAddress", "adr", "workmanshipGuarantee", "reviewUrl", "vatNumber"]) {
    if (typeof c[k] !== "string" || !(c[k] as string).trim()) delete c[k];
  }
  const blankGroup = (g: Record<string, unknown> | undefined) => !g || Object.values(g).every((v) => typeof v !== "string" || !v.trim());
  for (const k of ["fgasCompanyCert", "insurance", "bank"]) {
    const g = c[k] as Record<string, string> | undefined;
    if (blankGroup(g)) delete c[k];
    else if (g && g.expiresOn === "") delete g.expiresOn;
  }
  return {
    ...s,
    company: c as PilotSettings["company"],
    discounts: s.discounts.map((d) => ({
      code: d.code,
      label: d.label,
      ...(d.pct !== undefined ? { pct: d.pct } : {}),
      ...(d.amountPence !== undefined ? { amountPence: d.amountPence } : {}),
      reason: d.reason,
      active: d.active,
    })),
    serviceArea: { outcodes: [...new Set(s.serviceArea.outcodes)] },
    warranty: { workmanshipYears: s.warranty.workmanshipYears, manufacturerSummary: s.warranty.manufacturerSummary?.trim() ? s.warranty.manufacturerSummary.trim() : null },
  } as PilotSettings;
}

export async function saveSettingsAction(fd: FormData): Promise<ActionResult> {
  const admin = await requireStaff("settings.edit");
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("payload") ?? "null"));
  } catch {
    return refused("The settings didn't arrive in one piece. Please try again.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refused(issue ? `${issue.message}${issue.path.length ? ` (${issue.path.join(" › ")})` : ""}` : "Check the settings and try again.");
  }
  const discountCodes = parsed.data.discounts.map((d) => d.code);
  if (new Set(discountCodes).size !== discountCodes.length) return refused("Two discounts share a code. Each code must be unique.");
  if (parsed.data.discounts.some((d) => d.pct === undefined && d.amountPence === undefined)) return refused("Each discount needs a percentage or an amount.");

  // Someone else saved since this page was opened: don't overwrite their change.
  const loadedAt = String(fd.get("loadedAt") ?? "");
  const row = await settingsRepo.getRow(settingsRepo.PILOT_SETTINGS_KEY);
  if (row?.updatedAt && loadedAt && row.updatedAt !== loadedAt) {
    return refused(`${row.updatedBy ?? "Someone"} saved the settings after you opened this page. Reload to see their changes, then make yours again.`);
  }

  try {
    const saved = await saveSettings(mergeSettings(tidy(parsed.data)), admin);
    revalidatePath("/ops/settings");
    revalidatePath("/ops/launch");
    revalidatePath("/ops/messages");
    const missing = schedule2Missing(saved);
    return done(missing.length ? `Saved. Proposals still can't be issued until these are filled in: ${missing.join(", ")}.` : "Saved.");
  } catch (err) {
    console.error("[settings] save failed:", err);
    return refused("The settings couldn't be saved. Nothing changed; please try again.");
  }
}
