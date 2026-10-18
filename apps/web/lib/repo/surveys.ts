import type { MeasuredSurvey, SurveyRecord } from "@aircon/domain";
import { compact, db, isUniqueViolation, isUuid, jsonObject, must, nowIso, optNum, optStr, type Row } from "./base";

/**
 * `surveys`: the measured survey from the home visit, one row per version.
 * Typed columns hold the record's envelope; `data` holds the MeasuredSurvey.
 * A re-survey is a new version; the customer's self-survey on quote_requests
 * is never overwritten.
 */

const TABLE = "surveys";

export function fromRow(row: Row): SurveyRecord {
  const surveyor = jsonObject<{ staffId?: unknown; name?: unknown }>(row.surveyor);
  return compact<SurveyRecord>({
    id: String(row.id),
    projectId: String(row.project_id),
    version: optNum(row.version) ?? 1,
    status: row.status === "submitted" ? "submitted" : "draft",
    data: jsonObject<MeasuredSurvey>(row.data),
    surveyor:
      typeof surveyor.staffId === "string" && typeof surveyor.name === "string"
        ? { staffId: surveyor.staffId, name: surveyor.name }
        : undefined,
    startedAt: optStr(row.started_at),
    submittedAt: optStr(row.submitted_at),
    minutes: optNum(row.minutes),
  });
}

export function toRow(s: SurveyRecord): Row {
  return {
    id: s.id,
    project_id: s.projectId,
    version: s.version,
    status: s.status,
    data: s.data,
    surveyor: s.surveyor ?? null,
    started_at: s.startedAt ?? null,
    submitted_at: s.submittedAt ?? null,
    minutes: s.minutes ?? null,
  };
}

export async function get(id: string): Promise<SurveyRecord | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "surveys get");
  return data ? fromRow(data) : null;
}

/** Every version, newest first. */
export async function listForProject(projectId: string): Promise<SurveyRecord[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("version", { ascending: false }),
    "surveys listForProject",
  );
  return (data ?? []).map(fromRow);
}

/** The live survey: the highest version, draft or submitted. */
export async function currentForProject(projectId: string): Promise<SurveyRecord | null> {
  if (!isUuid(projectId)) return null;
  const data = must(
    await db()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "surveys currentForProject",
  );
  return data ? fromRow(data) : null;
}

/** Insert a new version. Throws on a clash: (project_id, version) is unique. */
export async function insert(record: SurveyRecord): Promise<SurveyRecord> {
  const data = must(await db().from(TABLE).insert(toRow(record)).select("*").single(), "surveys insert");
  return fromRow(data!);
}

/**
 * Insert a new version, or hand back the row that already holds that
 * (project, version): a double-tapped "Start survey" or an offline retry
 * reuses the draft that's there instead of failing. `created` says which.
 */
export async function insertOrReuse(record: SurveyRecord): Promise<{ record: SurveyRecord; created: boolean }> {
  const res = await db().from(TABLE).insert(toRow(record)).select("*").single();
  if (isUniqueViolation(res.error)) {
    const existing = must(
      await db().from(TABLE).select("*").eq("project_id", record.projectId).eq("version", record.version).maybeSingle(),
      "surveys reuse",
    );
    if (existing) return { record: fromRow(existing), created: false };
  }
  return { record: fromRow(must(res, "surveys insert")!), created: true };
}

export async function update(record: SurveyRecord): Promise<SurveyRecord> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(record), updated_at: nowIso() })
      .eq("id", record.id)
      .select("*")
      .maybeSingle(),
    "surveys update",
  );
  if (!data) throw new Error(`surveys update: ${record.id} not found`);
  return fromRow(data);
}
