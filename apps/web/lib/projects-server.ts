import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyProjectAction,
  createProject,
  currentStage,
  generateQuote,
  isProjectComplete,
  type Project,
  type ProjectAction,
  type QuoteResult,
  type Survey,
} from "@aircon/domain";
import { notifyProjectCreated } from "./project-notify";
import { getServiceClient } from "./supabase-server";

/**
 * Server-side project persistence. The JSONB snapshot is the truth; the
 * denormalised columns exist for ops list views and are recomputed on every
 * save so they can never drift.
 */

function denormalise(project: Project) {
  return {
    customer_name: project.customer.name,
    postcode: project.customer.postcode,
    current_stage: currentStage(project),
    completed: isProjectComplete(project),
    site_visit_at: project.siteVisit.scheduledFor ?? null,
    delivery_expected_on: project.delivery.expectedDate ?? null,
    install_on: project.installation.date ?? null,
    updated_at: new Date().toISOString(),
    project,
  };
}

export async function loadProject(id: string): Promise<Project | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data } = await supabase.from("projects").select("project").eq("id", id).single();
  return (data?.project as Project) ?? null;
}

export async function saveProject(supabase: SupabaseClient, project: Project): Promise<boolean> {
  const { error } = await supabase
    .from("projects")
    .update(denormalise(project))
    .eq("id", project.id);
  if (error) console.error("project save failed:", error.message);
  return !error;
}

/**
 * Create the project for a saved quote. Idempotent: one project per quote,
 * repeat calls return the existing project's id.
 */
export async function createProjectForQuote(
  quoteId: string,
): Promise<{ id: string } | { error: string; status: number }> {
  const supabase = getServiceClient();
  if (!supabase) return { error: "demo", status: 200 };

  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const { data: quoteRow } = await supabase
    .from("quote_requests")
    .select("id, customer_name, survey, quote")
    .eq("id", quoteId)
    .single();
  if (!quoteRow) return { error: "Quote not found", status: 404 };

  const now = new Date().toISOString();
  const project = createProject({
    id: crypto.randomUUID(),
    quoteId,
    createdAt: now,
    customerName: quoteRow.customer_name,
    survey: quoteRow.survey as Survey,
    quote: quoteRow.quote as QuoteResult,
  });

  const { data, error } = await supabase
    .from("projects")
    .insert({ id: project.id, quote_id: quoteId, ...denormalise(project) })
    .select("id")
    .single();

  if (error || !data) {
    // Lost a race with a concurrent create; the unique quote_id makes this safe.
    const { data: raced } = await supabase
      .from("projects")
      .select("id")
      .eq("quote_id", quoteId)
      .maybeSingle();
    if (raced) return { id: raced.id };
    console.error("project insert failed:", error?.message);
    return { error: "Could not create project", status: 502 };
  }
  // Fresh create only (races/revisits return above): the timeline-link email,
  // so losing the browser tab never means losing the journey.
  await notifyProjectCreated(data.id, quoteId);
  return { id: data.id };
}

/** Load, apply one reducer action, save. The single server-side write path. */
export async function applyAndSave(
  id: string,
  action: ProjectAction,
): Promise<{ project: Project } | { error: string; status: number }> {
  const supabase = getServiceClient();
  if (!supabase) return { error: "demo", status: 200 };

  const { data } = await supabase.from("projects").select("project").eq("id", id).single();
  if (!data) return { error: "Project not found", status: 404 };

  const result = applyProjectAction(data.project as Project, action, new Date().toISOString());
  if (!result.ok) return { error: result.error, status: 409 };

  const saved = await saveProject(supabase, result.project);
  if (!saved) return { error: "Could not save project", status: 502 };
  return { project: result.project };
}

/* ------------------------------------------------------------------ */
/* Demo mode                                                          */
/* ------------------------------------------------------------------ */

const DEMO_SURVEY: Survey = {
  postcode: "SW4 7AA",
  addressLine: "12 Larkhall Rise",
  archetypeId: "thirties-semi",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [
    {
      id: "demo-r1",
      name: "Main bedroom",
      type: "bedroom",
      size: "medium",
      floor: "first",
      glazing: "medium",
      orientation: "south",
      hasExternalWall: true,
      photos: [{ id: "demo-p1", kind: "room" }],
    },
    {
      id: "demo-r2",
      name: "Living room",
      type: "living-room",
      size: "large",
      floor: "ground",
      glazing: "high",
      orientation: "west",
      hasExternalWall: true,
      photos: [{ id: "demo-p2", kind: "room" }],
    },
    {
      id: "demo-r3",
      name: "Home office",
      type: "home-office",
      size: "small",
      floor: "first",
      glazing: "medium",
      orientation: "east",
      hasExternalWall: true,
      photos: [{ id: "demo-p3", kind: "room" }],
    },
  ],
  outdoor: { location: "ground-rear", photos: [{ id: "demo-p4", kind: "outdoor-location" }] },
  electrics: {
    condition: "modern-spare-ways",
    photos: [{ id: "demo-p5", kind: "fuse-board" }],
  },
};

/**
 * A fresh demo project for /p/demo. The whole journey is playable in the
 * browser (the client runs the same reducer; nothing persists).
 */
export function buildDemoProject(): Project {
  return createProject({
    id: "demo",
    quoteId: "demo",
    createdAt: new Date().toISOString(),
    customerName: "Alex Morgan",
    survey: DEMO_SURVEY,
    quote: generateQuote(DEMO_SURVEY),
  });
}
