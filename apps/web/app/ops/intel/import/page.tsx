import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/server";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";
import { EpcImporter } from "./epc-importer";

export const metadata: Metadata = { title: "Import EPC data" };

export default async function EpcImportPage() {
  await requireStaff("settings.edit");
  const settings = await getSettings();
  const connected = Boolean(getServiceClient());

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/ops/intel" className="text-sm font-medium text-accent-700 hover:underline">
        ← Property intelligence
      </Link>
      <h1 className="mt-3 text-2xl font-display">Import EPC data</h1>
      <p className="mt-2 text-sm text-ink-600">
        Load the government&apos;s energy certificate files into the book. Your browser reads them on this
        computer and sends only the homes in the postcodes below, so the full download (gigabytes) never leaves
        your laptop. Each home keeps its newest certificate, and anything we&apos;ve learned about a home
        (audits, planning, campaigns) is kept.
      </p>

      <ol className="mt-5 list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
        <li>
          Download the domestic data from{" "}
          <a
            className="font-medium text-accent-700 underline-offset-2 hover:underline"
            href="https://get-energy-performance-data.communities.gov.uk/"
            target="_blank"
            rel="noreferrer"
          >
            Get energy performance of buildings data
          </a>{" "}
          (sign in with GOV.UK One Login).
        </li>
        <li>Double-click the zip to unzip it. You get one file per year, certificates-2008.csv to the latest.</li>
        <li>Choose all of them below (click the first, then Cmd+A), check the postcodes, and press Import.</li>
        <li>Keep this tab open until it says done. A full set takes roughly 10 to 30 minutes.</li>
      </ol>

      {connected ? (
        <EpcImporter defaultOutcodes={settings.serviceArea.outcodes.join(", ")} />
      ) : (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No database is connected, so there&apos;s nowhere to save the homes. Connect Supabase first (see
          START-HERE step 4).
        </p>
      )}
    </main>
  );
}
