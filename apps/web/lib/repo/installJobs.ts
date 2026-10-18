import type {
  CommissioningRecord,
  ExceptionReview,
  InstallJobV2,
  InstallStep,
  Project,
  QaStatus,
  StepStatusRecord,
} from "@aircon/domain";
import { compact, db, isUuid, jsonArray, jsonObject, must, nowIso, optStr, uuidOrNull, type Row } from "./base";
import * as evidenceRepo from "./evidence";

/**
 * `install_jobs`: one per project. The row stores what only the job knows
 * (runsheet, step outcomes, exception reviews, QA, commissioning); evidence
 * lives in `install_evidence` so captures from several phones never
 * overwrite each other, and the job's header (customer, postcode, lead
 * engineer, start date) comes from the project snapshot. `loadForProject`
 * assembles the full InstallJobV2 the domain functions take.
 */

const TABLE = "install_jobs";

/** The stored part of an install job. */
export type InstallJobParts = Pick<
  InstallJobV2,
  "id" | "projectId" | "designId" | "templateVersion" | "runsheet" | "stepStatuses" | "exceptionReviews" | "commissioning" | "qa"
>;

const QA_STATUSES: QaStatus[] = ["in-progress", "auto-approved", "exceptions", "signed-off"];

export function fromRow(row: Row): InstallJobParts {
  const qa = jsonObject<{ status?: unknown; reviewedBy?: unknown; note?: unknown }>(row.qa);
  return compact<InstallJobParts>({
    id: String(row.id),
    projectId: String(row.project_id),
    designId: optStr(row.design_id),
    templateVersion: String(row.template_version ?? ""),
    runsheet: jsonArray<InstallStep>(row.runsheet),
    stepStatuses: jsonArray<StepStatusRecord>(row.step_statuses),
    exceptionReviews: jsonArray<ExceptionReview>(row.exception_reviews),
    commissioning:
      row.commissioning && typeof row.commissioning === "object"
        ? (row.commissioning as CommissioningRecord)
        : undefined,
    qa: compact({
      status: QA_STATUSES.includes(qa.status as QaStatus) ? (qa.status as QaStatus) : "in-progress",
      reviewedBy: optStr(qa.reviewedBy),
      note: optStr(qa.note),
    }),
  });
}

function toRow(job: InstallJobParts): Row {
  return {
    id: job.id,
    project_id: job.projectId,
    design_id: uuidOrNull(job.designId),
    template_version: job.templateVersion,
    runsheet: job.runsheet,
    step_statuses: job.stepStatuses,
    exception_reviews: job.exceptionReviews,
    commissioning: job.commissioning ?? null,
    qa: job.qa,
  };
}

export async function getForProject(projectId: string): Promise<InstallJobParts | null> {
  if (!isUuid(projectId)) return null;
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).maybeSingle(),
    "install_jobs getForProject",
  );
  return data ? fromRow(data) : null;
}

/** Create or replace the project's job (one per project). Evidence is never touched here. */
export async function save(job: InstallJobParts | InstallJobV2): Promise<InstallJobParts> {
  const parts: InstallJobParts = {
    id: job.id,
    projectId: job.projectId,
    designId: job.designId,
    templateVersion: job.templateVersion,
    runsheet: job.runsheet,
    stepStatuses: job.stepStatuses,
    exceptionReviews: job.exceptionReviews,
    commissioning: job.commissioning,
    qa: job.qa,
  };
  const data = must(
    await db()
      .from(TABLE)
      .upsert({ ...toRow(parts), updated_at: nowIso() }, { onConflict: "project_id" })
      .select("*")
      .single(),
    "install_jobs save",
  );
  return fromRow(data!);
}

/** Who leads on site: the technical lead on the crew, else the first person on it. */
function leadEngineer(project: Project | null | undefined): string {
  const crew = project?.booking.crew ?? [];
  return (crew.find((m) => m.role === "tech-lead") ?? crew[0])?.name ?? "";
}

/**
 * The full job for the domain functions (runsheetProgress, canRecord,
 * commissioningFromJob): stored parts + the evidence log + a header from
 * the project. Null when no job has been created yet.
 */
export async function loadForProject(projectId: string, project?: Project | null): Promise<InstallJobV2 | null> {
  const parts = await getForProject(projectId);
  if (!parts) return null;
  const evidence = await evidenceRepo.listForProject(projectId);
  return {
    ...parts,
    customer: project?.customer.name ?? "",
    postcode: project?.customer.postcode ?? "",
    engineer: leadEngineer(project),
    scheduledOn: project?.booking.startDate ?? "",
    evidence: evidence.map(({ projectId: _projectId, ...record }) => record),
  };
}
