import { db, must, nowIso, optStr, type Row } from "./base";

/**
 * `settings`: business configuration as keyed JSON. Raw access only: read
 * PilotSettings through lib/settings-server.ts, which merges over the domain
 * defaults and audits saves.
 */

const TABLE = "settings";

/** The key PilotSettings lives under. */
export const PILOT_SETTINGS_KEY = "pilot";

export interface SettingsRow {
  key: string;
  value: unknown;
  updatedAt?: string;
  updatedBy?: string;
}

export async function getRow(key: string): Promise<SettingsRow | null> {
  const data = must(await db().from(TABLE).select("*").eq("key", key).maybeSingle(), "settings get") as Row | null;
  if (!data) return null;
  return {
    key: String(data.key),
    value: data.value ?? null,
    updatedAt: optStr(data.updated_at),
    updatedBy: optStr(data.updated_by),
  };
}

export async function getValue(key: string): Promise<unknown | null> {
  return (await getRow(key))?.value ?? null;
}

export async function setValue(key: string, value: unknown, updatedBy?: string): Promise<void> {
  must(
    await db()
      .from(TABLE)
      .upsert({ key, value, updated_at: nowIso(), updated_by: updatedBy ?? null }, { onConflict: "key" }),
    "settings set",
  );
}
