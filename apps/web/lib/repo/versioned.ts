import { db, isUuid, jsonObject, must, nowIso, optNum, type Row } from "./base";

/**
 * Shared shape for the versioned record tables (`designs`, `proposals`):
 * `id`, `project_id`, `version`, `status` and the domain record in `record`
 * JSONB, unique on (project_id, version). Each table module adds its own
 * typed columns and helpers on top.
 */

interface VersionedRecord {
  id: string;
  projectId: string;
  version: number;
  status: string;
}

export function versionedTable<T extends VersionedRecord>(
  table: string,
  extraColumns: (record: T) => Row = () => ({}),
) {
  const fromRow = (row: Row): T => {
    // The snapshot is the truth; the envelope columns pin identity.
    const record = jsonObject<T>(row.record);
    return {
      ...record,
      id: String(row.id),
      projectId: String(row.project_id),
      version: optNum(row.version) ?? record.version ?? 1,
    };
  };

  const toRow = (record: T): Row => ({
    id: record.id,
    project_id: record.projectId,
    version: record.version,
    status: record.status,
    record,
    ...extraColumns(record),
  });

  async function get(id: string): Promise<T | null> {
    if (!isUuid(id)) return null;
    const data = must(await db().from(table).select("*").eq("id", id).maybeSingle(), `${table} get`);
    return data ? fromRow(data) : null;
  }

  /** Every version, newest first. */
  async function listForProject(projectId: string): Promise<T[]> {
    if (!isUuid(projectId)) return [];
    const data = must(
      await db().from(table).select("*").eq("project_id", projectId).order("version", { ascending: false }),
      `${table} listForProject`,
    );
    return (data ?? []).map(fromRow);
  }

  /** The highest version, whatever its status (null when there's none). */
  async function latestForProject(projectId: string, opts: { statuses?: string[] } = {}): Promise<T | null> {
    if (!isUuid(projectId)) return null;
    let q = db().from(table).select("*").eq("project_id", projectId);
    if (opts.statuses) q = q.in("status", opts.statuses);
    const data = must(
      await q.order("version", { ascending: false }).limit(1).maybeSingle(),
      `${table} latestForProject`,
    );
    return data ? fromRow(data) : null;
  }

  /** The next free version number for a project. */
  async function nextVersion(projectId: string): Promise<number> {
    const latest = await latestForProject(projectId);
    return (latest?.version ?? 0) + 1;
  }

  /** Insert one version. A duplicate (project, version) throws: re-read and bump. */
  async function insert(record: T): Promise<T> {
    const data = must(await db().from(table).insert(toRow(record)).select("*").single(), `${table} insert`);
    return fromRow(data!);
  }

  async function update(record: T): Promise<T> {
    const data = must(
      await db()
        .from(table)
        .update({ ...toRow(record), updated_at: nowIso() })
        .eq("id", record.id)
        .select("*")
        .maybeSingle(),
      `${table} update`,
    );
    if (!data) throw new Error(`${table} update: ${record.id} not found`);
    return fromRow(data);
  }

  return { fromRow, toRow, get, listForProject, latestForProject, nextVersion, insert, update };
}
