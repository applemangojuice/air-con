import { compact, db, jsonObject, must, optStr, type Row } from "./base";

/**
 * `audit_log`: who did what, append-only. Write through lib/audit.ts (which
 * never throws); read here for activity feeds.
 */

const TABLE = "audit_log";

export interface AuditEntry {
  id: string;
  at: string;
  actorKind: "staff" | "customer" | "system";
  actorId?: string;
  actorName?: string;
  action: string;
  entity: string;
  entityId?: string;
  detail: Record<string, unknown>;
}

export function fromRow(row: Row): AuditEntry {
  const kind = row.actor_kind;
  return compact<AuditEntry>({
    id: String(row.id),
    at: String(row.at),
    actorKind: kind === "staff" || kind === "customer" ? kind : "system",
    actorId: optStr(row.actor_id),
    actorName: optStr(row.actor_name),
    action: String(row.action),
    entity: String(row.entity),
    entityId: optStr(row.entity_id),
    detail: jsonObject<Record<string, unknown>>(row.detail),
  });
}

export async function insert(entry: Omit<AuditEntry, "id" | "at"> & { at?: string }): Promise<void> {
  must(
    await db()
      .from(TABLE)
      .insert({
        ...(entry.at ? { at: entry.at } : {}),
        actor_kind: entry.actorKind,
        actor_id: entry.actorId ?? null,
        actor_name: entry.actorName ?? null,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        detail: entry.detail,
      }),
    "audit insert",
  );
}

/** One record's history, newest first. */
export async function listForEntity(entity: string, entityId: string, limit = 100): Promise<AuditEntry[]> {
  const data = must(
    await db()
      .from(TABLE)
      .select("*")
      .eq("entity", entity)
      .eq("entity_id", entityId)
      .order("at", { ascending: false })
      .limit(limit),
    "audit listForEntity",
  );
  return (data ?? []).map(fromRow);
}

/** Everything, newest first. */
export async function listRecent(limit = 100): Promise<AuditEntry[]> {
  const data = must(
    await db().from(TABLE).select("*").order("at", { ascending: false }).limit(limit),
    "audit listRecent",
  );
  return (data ?? []).map(fromRow);
}
