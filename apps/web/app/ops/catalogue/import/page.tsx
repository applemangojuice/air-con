import type { Metadata } from "next";
import { PageHeader } from "@/components/kit";
import { CsvImport } from "@/components/ops/design/catalogue/csv-import";
import { requireStaff } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Import catalogue · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireStaff("catalogue.edit");
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        back={{ href: "/ops/catalogue", label: "Catalogue" }}
        eyebrow="Catalogue"
        title="Import a CSV"
        subtitle="Supplier price lists, datasheet figures, new materials. You see every change and every problem before anything is saved."
      />
      <CsvImport />
    </main>
  );
}
