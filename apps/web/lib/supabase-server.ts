import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for API routes. Returns null when Supabase isn't
 * configured, which switches the app into demo mode (quotes compute and
 * render, nothing persists).
 */
export function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const PHOTO_BUCKET = "survey-photos";
