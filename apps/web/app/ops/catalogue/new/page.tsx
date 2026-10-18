import type { Metadata } from "next";
import { CATALOGUE_KINDS, itemDisplayName, type CatalogueItem } from "@aircon/domain";
import { PageHeader } from "@/components/kit";
import { ItemForm } from "@/components/ops/design/catalogue/item-form";
import { requireStaff } from "@/lib/auth/server";
import { loadCatalogue } from "@/lib/catalogue-server";
import { londonToday } from "@/lib/project-service";

export const metadata: Metadata = { title: "New catalogue item · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NewCatalogueItemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff("catalogue.edit");
  const sp = await searchParams;
  const wanted = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind;
  const kind = (CATALOGUE_KINDS as string[]).includes(wanted ?? "") ? (wanted as CatalogueItem["kind"]) : "material";
  const { items } = await loadCatalogue();
  const pairOptions = items.filter((i) => i.kind === "indoor" || i.kind === "outdoor").map((i) => ({ id: i.id, label: itemDisplayName(i) }));
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader back={{ href: "/ops/catalogue", label: "Catalogue" }} eyebrow="Catalogue" title="Add an item" subtitle="New equipment, a material, or a service. Blank figures stay blank until a datasheet confirms them." />
      <ItemForm item={null} defaultKind={kind} today={londonToday()} pairOptions={pairOptions} />
    </main>
  );
}
