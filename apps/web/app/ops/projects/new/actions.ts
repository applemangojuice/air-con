"use server";

import { z } from "zod";
import { buildDefaultConfig, generateQuote, isInServiceArea, type Survey } from "@aircon/domain";
import { done, refused, type ActionResult } from "@/components/ops/command/types";
import { audit } from "@/lib/audit";
import { CUSTOMER_EMAIL_LINK_TTL_DAYS, issueMagicLink } from "@/lib/auth/magic";
import { requireStaff } from "@/lib/auth/server";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import { createProjectForQuote, dispatch } from "@/lib/project-service";
import { isUniqueViolation } from "@/lib/repo/base";
import { getSettings } from "@/lib/settings-server";
import { requireDb } from "@/lib/supabase-server";

/**
 * New pilot (plan §3 stage 1): a household set up from ops in about thirty
 * seconds. Writes the same quote_requests row the funnel writes (source
 * "ops"), then the v2 project through project-service, tagged, owned by
 * whoever made it, and optionally emails the customer a link into it.
 *
 * Idempotent on the form's own request id (used as the quote id), so a
 * double tap or a retry on a bad connection never makes two households.
 */

const schema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(2, "Enter their name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address (proposals and contracts go there)").max(200),
  phone: z.union([z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, "That phone number doesn't look right"), z.literal("")]),
  addressLine: z.string().trim().min(3, "Enter the first line of the address").max(200),
  postcode: z.string().trim().refine(isValidUkPostcode, "Enter a full UK postcode, like SW16 2BE"),
  type: z.enum(["detached", "semi-detached", "terraced", "flat", "bungalow"]),
  era: z.enum(["pre-1930", "1930-1950", "1950-2000", "2000+"]),
  bedrooms: z.coerce.number().int().min(1).max(6),
  bathrooms: z.coerce.number().int().min(0).max(4),
  layout: z.enum(["open-plan", "separate", "two-receptions", "other"]),
  floorAreaM2: z.union([z.coerce.number().min(30).max(1000), z.literal("")]),
  ownership: z.enum(["owner", "renting"]),
  electrics: z.enum(["modern-spare-ways", "modern-full", "older-fuse-box", "unsure"]),
  pilotNumber: z.coerce.number().int().min(1, "Pilot number must be 1 or more").max(999),
  pilotLabel: z.string().trim().min(1, "Give the pilot a short label (an area, not the address)").max(80),
  note: z.string().trim().max(2000),
  sendLink: z.boolean(),
});

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function createPilotAction(fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff("projects.edit");
  const parsed = schema.safeParse({
    requestId: field(fd, "requestId"),
    name: field(fd, "name"),
    email: field(fd, "email"),
    phone: field(fd, "phone").trim(),
    addressLine: field(fd, "addressLine"),
    postcode: field(fd, "postcode"),
    type: field(fd, "type"),
    era: field(fd, "era"),
    bedrooms: field(fd, "bedrooms"),
    bathrooms: field(fd, "bathrooms") || "1",
    layout: field(fd, "layout"),
    floorAreaM2: field(fd, "floorAreaM2").trim(),
    ownership: field(fd, "ownership") || "owner",
    electrics: field(fd, "electrics") || "unsure",
    pilotNumber: field(fd, "pilotNumber"),
    pilotLabel: field(fd, "pilotLabel"),
    note: field(fd, "note"),
    sendLink: field(fd, "sendLink") === "on",
  });
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const d = parsed.data;
  const postcode = normalisePostcode(d.postcode);
  const db = requireDb();

  // The funnel's own shape: a default room set for the house, priced by the engine.
  const config = buildDefaultConfig({
    type: d.type,
    era: d.era,
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    layout: d.layout,
    ...(d.floorAreaM2 !== "" ? { floorAreaM2: d.floorAreaM2 } : {}),
  });
  const survey: Survey = {
    postcode,
    addressLine: d.addressLine,
    ...(config.archetypeId ? { archetypeId: config.archetypeId } : {}),
    ...(config.permutationId ? { permutationId: config.permutationId } : {}),
    property: {
      type: d.type,
      era: d.era,
      bedrooms: d.bedrooms,
      bathrooms: d.bathrooms,
      ...(d.floorAreaM2 !== "" ? { floorAreaM2: d.floorAreaM2 } : {}),
      ownership: d.ownership,
    },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: d.electrics, photos: [] },
  };
  const quote = generateQuote(survey);

  const { error: insertError } = await db.from("quote_requests").insert({
    id: d.requestId,
    customer_name: d.name,
    email: d.email,
    phone: d.phone || null,
    timeframe: null,
    postcode,
    address_line: d.addressLine,
    engine_version: quote.engineVersion,
    survey,
    quote,
    total_gbp: quote.totalGbp,
    room_count: survey.rooms.length,
    confidence_score: quote.confidence.score,
    confidence_band: quote.confidence.band,
    source: "ops",
    status: "new",
  });
  // A retry of the same form: the quote is already there, carry on to its project.
  if (insertError && !isUniqueViolation(insertError)) {
    console.error("[new pilot] quote insert failed:", insertError.message);
    return refused("The household couldn't be saved. Nothing was created; please try again.");
  }

  const created = await createProjectForQuote(d.requestId, {
    pilot: { number: d.pilotNumber, label: d.pilotLabel },
    contact: { email: d.email, ...(d.phone ? { phone: d.phone } : {}) },
    actor: staff,
  });
  if ("error" in created) return refused(created.error === "demo" ? "There's no database connected." : `The project couldn't be created: ${created.error}`);
  const id = created.id;

  if (!created.created) {
    return done("This household was already set up (the form was sent twice). Opening it.", { href: `/ops/projects/${id}` });
  }

  await dispatch(id, { type: "set-owner", staffId: staff.id, name: staff.name }, staff);
  if (d.note) await dispatch(id, { type: "note", text: d.note }, staff);
  await audit({ actor: staff, action: "pilot.create", entity: "project", entityId: id, detail: { pilot: d.pilotNumber, sendLink: d.sendLink } });

  const settings = await getSettings();
  const outside = !isInServiceArea(settings, postcode);
  const notes: string[] = [];
  if (outside) notes.push(`${postcode} is outside the service area in settings.`);

  let detail: string | undefined;
  let linkState: "sent" | "unsent" | "none" = "none";
  if (d.sendLink) {
    linkState = "unsent";
    try {
      const link = await issueMagicLink({ email: d.email, kind: "customer", next: `/p/${id}`, ttlMinutes: CUSTOMER_EMAIL_LINK_TTL_DAYS * 24 * 60 });
      if (link.sent) {
        linkState = "sent";
        notes.push(`A link to their project went to ${d.email}.`);
      } else if (link.devLink) {
        notes.push("Email isn't set up here, so no link was sent.");
        detail = link.devLink;
      } else notes.push("The link couldn't be sent because email isn't set up.");
    } catch (err) {
      console.error("[new pilot] link failed:", err);
      notes.push("The link couldn't be sent.");
    }
  }
  const query = new URLSearchParams({ created: "1", ...(linkState !== "none" ? { link: linkState } : {}), ...(outside ? { area: "outside" } : {}) });
  return done(["Pilot set up.", ...notes].join(" "), { href: `/ops/projects/${id}?${query}`, ...(detail ? { detail } : {}) });
}
