"use server";

import { z } from "zod";
import { STAFF_ROLES, type StaffMember, type StaffRole } from "@aircon/domain";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { assignCrew, confirmBooking, recordEarlyStartEvidence, requestDeposit, setInstallDates } from "@/lib/booking-server";
import { isUuid } from "@/lib/repo/base";
import { invalid, poundsToPence, text, toState, type ActionState } from "./_f5/action-state";

/**
 * Booking actions (schedule.edit). Each one checks the session and the
 * project itself (server actions are reachable from anywhere), validates
 * its input, and answers with an ActionState for the form.
 */

async function guard(projectId: string): Promise<StaffMember | null> {
  const staff = await requireStaff("schedule.edit");
  if (!isUuid(projectId)) return null;
  const access = await requireProjectAccess(projectId, { perm: "schedule.edit" });
  return access?.kind === "staff" ? staff : null;
}

const NOT_FOUND: ActionState = { error: "That project isn't available to you." };

export async function setDatesAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(form.get("startDate"));
  if (!parsed.success) return invalid("Pick the first install day.");
  return toState(await setInstallDates(projectId, parsed.data, staff), "Install dates saved.");
}

const memberSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}:[a-z-]+$/i)
  .transform((v) => {
    const [staffId, role] = v.split(":") as [string, string];
    return { staffId, role: role as StaffRole };
  })
  .refine((m) => STAFF_ROLES.includes(m.role));

export async function assignCrewAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const parsed = z.array(memberSchema).max(8).safeParse(form.getAll("member"));
  if (!parsed.success) return invalid("Pick each person's role on the job.");
  return toState(await assignCrew(projectId, parsed.data, staff), "Crew saved.");
}

export async function confirmBookingAction(projectId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  return toState(await confirmBooking(projectId, staff), "Booking confirmed.");
}

export async function requestDepositAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const requestId = z.string().min(8).max(64).safeParse(form.get("requestId"));
  if (!requestId.success) return invalid("The page wasn't ready. Try again.");
  const expected = poundsToPence(form.get("expectedTotal"));
  return toState(await requestDeposit(projectId, expected ?? undefined, requestId.data, staff), "Deposit invoice sent.");
}

export async function earlyStartEvidenceAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const channel = z.enum(["email", "paper"]).safeParse(form.get("channel"));
  if (!channel.success) return invalid("Is it the customer's email or a signed form?");
  const ref = text(form, "evidenceRef", 200);
  if (!ref) return invalid("Say which email or form it is, so anyone can find it again.");
  return toState(await recordEarlyStartEvidence(projectId, { channel: channel.data, evidenceRef: ref }, staff), "Early-start request recorded.");
}
