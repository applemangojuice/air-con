"use server";

import { revalidatePath } from "next/cache";
import { COMMS_EVENTS, type CommsEventId } from "@aircon/domain";
import { done, refused, type ActionResult } from "@/components/ops/command/types";
import { audit } from "@/lib/audit";
import { requireStaff } from "@/lib/auth/server";
import { DAILY_JOB_LABEL, DAILY_JOB_IDS } from "@/lib/ops-core-schedule";
import { runDailyOps } from "@/lib/ops-core-server";
import { SETTINGS_UNAVAILABLE, saveSettings, settingsForWrite } from "@/lib/settings-server";
import { ALWAYS_ON } from "./always-on";
import { revalidateSettingsCaches } from "@/lib/public-settings";

/** Turn one message template on or off (settings.comms.disabledEvents). */
export async function toggleEventAction(fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff("settings.edit");
  const event = String(fd.get("event") ?? "") as CommsEventId;
  const on = String(fd.get("on") ?? "") === "1";
  if (!Object.prototype.hasOwnProperty.call(COMMS_EVENTS, event)) return refused("Unknown message.");
  if (!on && ALWAYS_ON[event]) return refused(`This one can't be turned off: ${ALWAYS_ON[event]}`);
  // Saved back whole: a failed read must never write the defaults over everything else.
  const settings = await settingsForWrite();
  if (!settings) return refused(SETTINGS_UNAVAILABLE);
  const disabled = new Set(settings.comms.disabledEvents);
  if (on) disabled.delete(event);
  else disabled.add(event);
  try {
    await saveSettings({ ...settings, comms: { ...settings.comms, disabledEvents: [...disabled] } }, staff);
    revalidateSettingsCaches();
  } catch (err) {
    console.error("[messages] toggle failed:", err);
    return refused("Settings couldn't be saved. Please try again.");
  }
  revalidatePath("/ops/messages");
  revalidatePath("/ops/settings");
  return done(on ? "Turned on." : "Turned off. Messages already queued for it won't be sent.");
}

/** The daily-ops cron, run by hand (same code, same idempotency). */
export async function runDailyJobsAction(): Promise<ActionResult> {
  const staff = await requireStaff("settings.edit");
  try {
    const summary = await runDailyOps();
    await audit({ actor: staff, action: "cron.daily-ops.manual", entity: "cron", detail: { projects: summary.projects, errors: summary.errors.length } });
    revalidatePath("/ops/messages");
    const did = DAILY_JOB_IDS.map((id) => ({ id, ...summary.jobs[id] }))
      .filter((j) => j.planned > 0)
      .map((j) => `${DAILY_JOB_LABEL[j.id]}: ${j.done} done${j.skipped ? `, ${j.skipped} skipped` : ""}${j.failed ? `, ${j.failed} failed` : ""}`);
    const outbox = summary.outbox;
    const lines = [
      did.length ? did.join(". ") + "." : "Nothing was due today.",
      `Outbox: ${outbox.due} due, ${outbox.sent} sent, ${outbox.demo} recorded in demo mode${outbox.failed ? `, ${outbox.failed} failed` : ""}.`,
    ];
    if (summary.errors.length) return refused(`${lines.join(" ")} Problems: ${summary.errors.slice(0, 3).join("; ")}`);
    return done(lines.join(" "));
  } catch (err) {
    console.error("[messages] daily ops failed:", err);
    return refused("The daily jobs didn't finish. Check the server log, then try again.");
  }
}
