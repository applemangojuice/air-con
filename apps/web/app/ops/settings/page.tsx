import type { Metadata } from "next";
import { mergeSettings } from "@aircon/domain";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { demoLoginAllowed } from "@/lib/auth/access";
import { requireStaff } from "@/lib/auth/server";
import { fmtInstant } from "@/components/ops/command/model";
import * as settingsRepo from "@/lib/repo/settings";
import { getServiceClient } from "@/lib/supabase-server";
import { saveSettingsAction } from "./actions";
import { SettingsEditor } from "./settings-editor";

export const metadata: Metadata = { title: "Settings · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The business's configuration (admin only): every decision that isn't code. */
export default async function SettingsPage() {
  await requireStaff("settings.edit");
  if (!getServiceClient()) {
    return (
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <PageHeader title="Settings" />
        <EmptyState title="No database connected" body="Settings are saved in the database." />
      </main>
    );
  }
  let row: Awaited<ReturnType<typeof settingsRepo.getRow>> = null;
  try {
    row = await settingsRepo.getRow(settingsRepo.PILOT_SETTINGS_KEY);
  } catch (err) {
    console.error("[settings] read failed:", err);
    return (
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <PageHeader title="Settings" />
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          Settings couldn&apos;t be read, so they can&apos;t be edited safely right now. Reload in a moment.
        </p>
      </main>
    );
  }
  const settings = mergeSettings(row?.value ?? {});

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <PageHeader
        title="Settings"
        subtitle={row?.updatedAt ? `Last saved ${fmtInstant(row.updatedAt, { year: true })}${row.updatedBy ? ` by ${row.updatedBy}` : ""}.` : "Never saved: these are the cautious defaults."}
      />
      <SettingsEditor initial={settings} loadedAt={row?.updatedAt ?? ""} action={saveSettingsAction} demoReset={demoLoginAllowed(process.env)} />
    </main>
  );
}
