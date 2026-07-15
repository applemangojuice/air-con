import { outcodeOf, type Project, type ScheduledJob } from "@aircon/domain";
import { getServiceClient } from "./supabase-server";

/**
 * Jobs for the scheduling and procurement modules: the thin planning slice
 * of every live project. Real mode reads the projects table; demo mode
 * fabricates a believable SW16/SW17 fortnight so both pages are explorable
 * with no database.
 */

export async function loadScheduledJobs(): Promise<ScheduledJob[]> {
  const supabase = getServiceClient();
  if (!supabase) return demoScheduledJobs(new Date().toISOString());

  const { data, error } = await supabase
    .from("projects")
    .select("id, customer_name, postcode, current_stage, completed, project")
    .eq("completed", false)
    .limit(500);
  if (error) {
    console.error("jobs query failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const project = row.project as Project;
    return {
      projectId: row.id,
      customer: row.customer_name,
      postcode: row.postcode,
      outcode: outcodeOf(row.postcode),
      stage: row.current_stage,
      installOn: project.installation.date,
      installDays: project.installation.installDays,
      siteVisitAt: project.siteVisit.scheduledFor,
      deliveryOn: project.delivery.expectedDate,
      systems: project.quoteSummary.systems,
      roomUnits: project.quoteSummary.roomDesigns.map((r) => r.unitLabel),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Demo jobs                                                           */
/* ------------------------------------------------------------------ */

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Next weekday at or after the offset, so demo installs skip weekends. */
function weekday(todayIso: string, offset: number): string {
  let date = addDays(todayIso, offset);
  for (let i = 0; i < 3; i++) {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    date = addDays(date, 1);
  }
  return date;
}

const IU = "2.5 kW wall-mounted indoor unit";
const IU_BIG = "3.5 kW wall-mounted indoor unit";

/**
 * A believable pipeline: installs over the next three weeks (including one
 * deliberate double-booking to show the conflict flag), site visits this
 * week, deliveries tracking install dates.
 */
export function demoScheduledJobs(todayIso: string): ScheduledJob[] {
  const d = (offset: number) => weekday(todayIso, offset);
  const job = (
    projectId: string,
    customer: string,
    postcode: string,
    stage: string,
    fields: Partial<ScheduledJob>,
  ): ScheduledJob => ({
    projectId,
    customer,
    postcode,
    outcode: outcodeOf(postcode),
    stage,
    installDays: 1,
    systems: ["3.5 kW multi-split outdoor unit (serves 3 rooms)"],
    roomUnits: [IU, IU, IU_BIG],
    ...fields,
  });

  return [
    job("demo-j1", "Alex Morgan", "SW16 2BE", "delivery", {
      installOn: d(3),
      deliveryOn: addDays(d(3), -2),
      installDays: 1,
    }),
    job("demo-j2", "Priya Shah", "SW17 2FJ", "delivery", {
      installOn: d(5),
      deliveryOn: addDays(d(5), -2),
      installDays: 2,
      systems: ["5.0 kW multi-split outdoor unit (serves 4 rooms)"],
      roomUnits: [IU, IU, IU, IU_BIG],
    }),
    // Same day as demo-j2's day two: the conflict the calendar should flag.
    job("demo-j3", "Marcus Webb", "SW17 2AB", "delivery", {
      installOn: addDays(d(5), 1),
      deliveryOn: addDays(d(5), -1),
      installDays: 1,
    }),
    job("demo-j4", "Leila Ahmed", "SW16 1AB", "installation", {
      installOn: d(9),
      deliveryOn: addDays(d(9), -2),
      installDays: 1,
      systems: ["2.5 kW outdoor unit"],
      roomUnits: [IU],
    }),
    job("demo-j5", "Tom Osei", "SW17 2FJ", "installation", {
      installOn: d(11),
      deliveryOn: addDays(d(11), -2),
      installDays: 1,
    }),
    job("demo-j6", "Nina Kovacs", "SW16 2BE", "installation", {
      installOn: d(16),
      deliveryOn: addDays(d(16), -2),
      installDays: 2,
      systems: ["5.0 kW multi-split outdoor unit (serves 4 rooms)"],
      roomUnits: [IU, IU, IU, IU],
    }),
    // Site-visit stage: in the diary but no install date yet.
    job("demo-j7", "Jordan Price", "SW17 2AB", "site-visit", {
      siteVisitAt: `${d(1)}T13:00:00.000Z`,
    }),
    job("demo-j8", "Sofia Rossi", "SW16 1AB", "site-visit", {
      siteVisitAt: `${d(2)}T10:00:00.000Z`,
    }),
    job("demo-j9", "Dev Patel", "SW16 2BE", "site-visit", {
      siteVisitAt: `${d(2)}T16:00:00.000Z`,
    }),
  ];
}
