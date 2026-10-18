import { currentStage, migrateProject, outcodeOf, type Project, type PurchaseOrder, type ScheduledJob } from "@aircon/domain";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import { getServiceClient } from "./supabase-server";

/**
 * Every live project, read once for the cross-project ops screens (the
 * calendar, purchasing, crew capacity). v1 rows are lifted to v2 on read,
 * exactly as project-service does, so nothing here touches the v1 machine.
 *
 * No database means no projects: these screens say so rather than showing
 * made-up jobs.
 */

export interface OpsProject {
  id: string;
  project: Project;
}

/**
 * Projects for scheduling: not closed, or closed recently enough to still
 * matter on a calendar (`includeClosed`). Unreadable snapshots are skipped
 * and logged, never fatal to the page.
 */
export async function loadOpsProjects(opts: { includeClosed?: boolean; limit?: number } = {}): Promise<OpsProject[]> {
  const db = getServiceClient();
  if (!db) return [];
  let q = db.from("projects").select("id, customer_id, completed, project");
  if (!opts.includeClosed) q = q.eq("completed", false);
  const { data, error } = await q.limit(opts.limit ?? 500);
  if (error) throw new Error(`ops projects: ${error.message}`);
  const out: OpsProject[] = [];
  for (const row of data ?? []) {
    try {
      const project = migrateProject(row.project);
      if (row.customer_id && !project.customer.customerId) project.customer.customerId = String(row.customer_id);
      out.push({ id: String(row.id), project: { ...project, id: String(row.id) } });
    } catch (err) {
      console.error(`[ops] project ${String(row.id)} has an unreadable snapshot:`, err);
    }
  }
  return out;
}

/** Every purchase order, grouped by project id. */
export async function loadPurchaseOrdersByProject(): Promise<Map<string, PurchaseOrder[]>> {
  if (!getServiceClient()) return new Map();
  const all = await purchaseOrdersRepo.list();
  const out = new Map<string, PurchaseOrder[]>();
  for (const po of all) out.set(po.projectId, [...(out.get(po.projectId) ?? []), po]);
  return out;
}

/**
 * The thin planning slice the older operations planners take (operations.ts
 * ScheduledJob), from v2 projects: booking dates, the survey time, the kit
 * ETA and the quoted systems.
 */
export async function loadScheduledJobs(): Promise<ScheduledJob[]> {
  const projects = await loadOpsProjects();
  return projects.map(({ id, project: p }) => ({
    projectId: id,
    customer: p.customer.name,
    postcode: p.customer.postcode,
    outcode: outcodeOf(p.customer.postcode),
    stage: currentStage(p),
    ...(p.booking.startDate ? { installOn: p.booking.startDate } : {}),
    installDays: p.booking.installDays,
    ...(p.survey.scheduledFor ? { siteVisitAt: p.survey.scheduledFor } : {}),
    ...(p.kit.expectedDate ? { deliveryOn: p.kit.expectedDate } : {}),
    systems: p.quoteSummary.systems,
    roomUnits: p.quoteSummary.roomDesigns.map((r) => r.unitLabel),
  }));
}
