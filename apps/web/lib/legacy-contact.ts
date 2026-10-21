import type { SupabaseClient } from "@supabase/supabase-js";
import { isLegacySnapshot, type Project } from "@aircon/domain";

/**
 * v1 projects kept the customer's email and phone on the quote, not on the
 * project. When a v1 snapshot is read, fill only its gaps from the quote, so
 * the migrated project carries them from then on (they're saved with it on
 * the next write).
 *
 * Only v1: a v2 project is created with the quote's details already copied
 * in, so there an empty field means "no address". Staff may have removed a
 * wrong one on purpose, and falling back to the quote would quietly send the
 * customer's messages (and sign-in links) back to it.
 */
export async function withLegacyContact(
  db: SupabaseClient,
  project: Project,
  rawSnapshot: unknown,
  quoteId: string | null | undefined,
): Promise<Project> {
  if (!isLegacySnapshot(rawSnapshot) || !quoteId || (project.customer.email && project.customer.phone)) return project;
  const { data: quote, error } = await db.from("quote_requests").select("email, phone").eq("id", quoteId).maybeSingle();
  if (error || !quote) return project;
  const email = typeof quote.email === "string" ? quote.email.trim() : "";
  const phone = typeof quote.phone === "string" ? quote.phone.trim() : "";
  const customer = { ...project.customer };
  if (!customer.email && email) customer.email = email;
  if (!customer.phone && phone) customer.phone = phone;
  return { ...project, customer };
}
