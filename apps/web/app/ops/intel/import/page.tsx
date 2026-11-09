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
        Load the government&apos;s energy certificate download into the book. Your browser reads it on this
        computer, straight out of the zip, and sends only the homes in the postcodes below: the gigabytes never
        leave your laptop and nothing is unzipped to disk. Each home keeps its newest certificate, and anything we&apos;ve learned about a home
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
        <li>
          Choose the zip below exactly as it downloaded: there&apos;s no need to unzip it (it would be several times
          bigger). Unzipped CSV files work too.
        </li>
        <li>
          It checks every file&apos;s columns first, in a few seconds. Then check the postcodes and press Import.
        </li>
        <li>
          Keep this tab open and the laptop plugged in. If it stops (sleep, Wi-Fi, closing the tab), choose the same
          zip again and press Resume: it carries on where it left off.
        </li>
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
