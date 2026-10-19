import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { requireStaff } from "@/lib/auth/server";
import { DEMO_PILOT_FROM } from "@/lib/project-service";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";
import { createPilotAction } from "./actions";
import { NewPilotForm } from "./new-pilot-form";

export const metadata: Metadata = { title: "New pilot · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NewPilotPage() {
  await requireStaff("projects.edit");
  const db = getServiceClient();
  if (!db) {
    return (
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <PageHeader back={{ href: "/ops/projects", label: "Board" }} title="New pilot" />
        <EmptyState title="No database connected" body="Households can only be set up when there's somewhere to save them." />
      </main>
    );
  }
  const [settings, { data: rows }] = await Promise.all([getSettings(), db.from("projects").select("pilot_number").not("pilot_number", "is", null)]);
  const used = (rows ?? []).map((r) => Number((r as { pilot_number: unknown }).pilot_number)).filter((n) => Number.isInteger(n) && n < DEMO_PILOT_FROM);
  const next = used.length ? Math.max(...used) + 1 : 1;

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        back={{ href: "/ops/projects", label: "Board" }}
        title="New pilot"
        subtitle="Set up a household in about thirty seconds. They get the same project page as a customer from the website."
      />
      <NewPilotForm action={createPilotAction} nextPilotNumber={next} serviceOutcodes={settings.serviceArea.outcodes} />
    </main>
  );
}
