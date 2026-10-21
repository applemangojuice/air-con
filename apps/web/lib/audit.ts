import type { StaffMember } from "@aircon/domain";
import { getServiceClient } from "./supabase-server";
import * as auditRepo from "./repo/audit";

/**
 * Who did what (contract §F). Every pilot write calls this after it commits:
 *
 *   await audit({ actor: staff, action: "settings.save", entity: "settings", entityId: "pilot" });
 *
 * Best-effort by design: the change has already happened, so a failed audit
 * write is logged loudly but never turns a success into an error. Without a
 * database (demo mode) there's nothing to audit.
 */

export type AuditActor =
  | { kind: "staff"; id: string; name: string }
  | { kind: "customer"; id: string; name?: string }
  | { kind: "system"; id?: string; name?: string };

export const SYSTEM_ACTOR: AuditActor = { kind: "system", name: "system" };

/** A staff record, an explicit actor, or nobody (the system). */
export type AuditActorInput = AuditActor | StaffMember | null | undefined;

export function toAuditActor(actor: AuditActorInput): AuditActor {
  if (!actor) return SYSTEM_ACTOR;
  if ("roles" in actor) return { kind: "staff", id: actor.id, name: actor.name };
  return actor;
}

export async function audit(entry: {
  actor: AuditActorInput;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!getServiceClient()) return;
  const actor = toAuditActor(entry.actor);
  try {
    await auditRepo.insert({
      actorKind: actor.kind,
      actorId: actor.id,
      actorName: actor.name,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? undefined,
      detail: entry.detail ?? {},
    });
  } catch (err) {
    console.error(`[audit] failed to record ${entry.action} on ${entry.entity}/${entry.entityId ?? "-"}:`, err);
  }
}
