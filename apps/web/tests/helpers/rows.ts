import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rows the local data backend accepts because Postgres would: every NOT
 * NULL column filled, and the rows other rows point at (a message, photo or
 * invoice belongs to a project that exists; a project to a quote). Tests use
 * these instead of half rows, so a write the database would refuse fails
 * here too.
 */

type Row = Record<string, unknown>;

/** A quote_requests row with every required column (what the funnel writes, minus the detail). */
export function quoteRow(over: Row = {}): Row {
  return {
    id: crypto.randomUUID(),
    email: "test.customer@example.com",
    postcode: "SW16 2BE",
    address_line: "1 Test Street",
    engine_version: "test",
    survey: {},
    quote: {},
    total_gbp: 0,
    room_count: 1,
    confidence_score: 0,
    confidence_band: "low",
    ...over,
  };
}

/** A projects row for `quoteId` with every required column. */
export function projectRow(quoteId: string, over: Row = {}): Row {
  return {
    id: crypto.randomUUID(),
    quote_id: quoteId,
    project: {},
    customer_name: "Test Customer",
    postcode: "SW16 2BE",
    current_stage: "quote",
    ...over,
  };
}

/**
 * Inserts a projects row, filling the required columns it leaves out, after
 * its quote (a new one when `quote_id` isn't in quote_requests yet).
 */
export async function insertProjectRow(db: SupabaseClient, row: Row): Promise<void> {
  const quoteId = String(row.quote_id ?? crypto.randomUUID());
  const { data: quote } = await db.from("quote_requests").select("id").eq("id", quoteId).maybeSingle();
  if (!quote) {
    const q = await db.from("quote_requests").insert(quoteRow({ id: quoteId }));
    if (q.error) throw new Error(`test quote row: ${q.error.message}`);
  }
  const p = await db.from("projects").insert(projectRow(quoteId, row));
  if (p.error) throw new Error(`test project row: ${p.error.message}`);
}

/**
 * Stores a quote and a project with this id (unless it's already there), so
 * rows that reference the project can be written. Returns the quote id.
 */
export async function ensureProjectRow(db: SupabaseClient, projectId: string, over: Row = {}): Promise<string> {
  const { data: existing } = await db.from("projects").select("quote_id").eq("id", projectId).maybeSingle();
  if (existing) return String((existing as Row).quote_id);
  const quote = quoteRow();
  const q = await db.from("quote_requests").insert(quote);
  if (q.error) throw new Error(`test quote row: ${q.error.message}`);
  const p = await db.from("projects").insert(projectRow(String(quote.id), { id: projectId, ...over }));
  if (p.error) throw new Error(`test project row: ${p.error.message}`);
  return String(quote.id);
}
