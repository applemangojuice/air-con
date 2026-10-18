import type { TimeEntry } from "@aircon/domain";
import { db, isUuid, jsonObject, must, uuidOrNull, type Row } from "./base";

/**
 * `time_entries`: the labour and travel log behind the pilot metrics' actual
 * hours. An entry with no `endedAt` is a clock still running.
 */

const TABLE = "time_entries";

export function fromRow(row: Row): TimeEntry {
  return { ...jsonObject<TimeEntry>(row.entry), id: String(row.id), projectId: String(row.project_id) };
}

export function toRow(entry: TimeEntry): Row {
  return {
    id: entry.id,
    project_id: entry.projectId,
    staff_id: uuidOrNull(entry.staffId),
    kind: entry.kind,
    started_at: entry.startedAt,
    ended_at: entry.endedAt ?? null,
    minutes: entry.minutes ?? null,
    entry,
  };
}

export async function get(id: string): Promise<TimeEntry | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "time get");
  return data ? fromRow(data) : null;
}

/** A project's log in time order. */
export async function listForProject(projectId: string): Promise<TimeEntry[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("started_at", { ascending: true }),
    "time listForProject",
  );
  return (data ?? []).map(fromRow);
}

/** One person's log, newest first. */
export async function listForStaff(staffId: string, opts: { sinceIso?: string } = {}): Promise<TimeEntry[]> {
  if (!isUuid(staffId)) return [];
  let q = db().from(TABLE).select("*").eq("staff_id", staffId);
  if (opts.sinceIso) q = q.gte("started_at", opts.sinceIso);
  const data = must(await q.order("started_at", { ascending: false }), "time listForStaff");
  return (data ?? []).map(fromRow);
}

/** The clock this person left running, if any (arrive without leave). */
export async function openForStaff(staffId: string): Promise<TimeEntry | null> {
  if (!isUuid(staffId)) return null;
  const data = must(
    await db()
      .from(TABLE)
      .select("*")
      .eq("staff_id", staffId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "time openForStaff",
  );
  return data ? fromRow(data) : null;
}

export async function insert(entry: TimeEntry): Promise<TimeEntry> {
  const data = must(await db().from(TABLE).insert(toRow(entry)).select("*").single(), "time insert");
  return fromRow(data!);
}

/** No updated_at on this table: an entry's own timestamps are the record. */
export async function update(entry: TimeEntry): Promise<TimeEntry> {
  const data = must(
    await db().from(TABLE).update(toRow(entry)).eq("id", entry.id).select("*").maybeSingle(),
    "time update",
  );
  if (!data) throw new Error(`time update: ${entry.id} not found`);
  return fromRow(data);
}
