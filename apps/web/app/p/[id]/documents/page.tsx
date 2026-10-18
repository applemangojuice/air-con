import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DOCUMENT_KIND_LABEL, type DocumentKind, type DocumentRecord } from "@aircon/domain";
import { CustomerNav, PortalShell, StaffNav } from "@/components/portal/shell";
import { LinkRequest } from "@/components/portal/sign-in";
import { requireProjectAccess } from "@/lib/auth/server";
import { listDocuments } from "@/lib/documents-server";
import { fmtDate } from "@/lib/format";
import { loadProject } from "@/lib/project-service";
import { getSettings } from "@/lib/settings-server";

export const metadata: Metadata = {
  title: "Your documents",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The order a household thinks about them in. */
const GROUPS: { title: string; kinds: DocumentKind[] }[] = [
  { title: "Your survey and proposal", kinds: ["survey-report", "proposal"] },
  { title: "Your contract", kinds: ["contract", "variation"] },
  { title: "Invoices and receipts", kinds: ["invoice", "receipt"] },
  { title: "Handover and certificates", kinds: ["handover-pack", "commissioning-certificate"] },
];

/**
 * Every document the customer has been given, in one list (contract §G
 * F1): customer-visible, current versions, each opening its printable page.
 */
export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  if (!UUID_RE.test(rawId)) notFound();
  const id = rawId.toLowerCase();
  const [access, settings] = await Promise.all([requireProjectAccess(id, { allowCustomer: true }), getSettings()]);

  if (!access) {
    return (
      <PortalShell width="narrow">
        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <h1 className="font-display text-3xl text-ink-900">Sign in to see your documents</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-700">We&apos;ll email a sign-in link to the address we have for this project.</p>
          <div className="mt-6">
            <LinkRequest target={{ projectId: id }} phone={settings.company.phone} />
          </div>
        </div>
      </PortalShell>
    );
  }

  const [project, docs] = await Promise.all([
    loadProject(id),
    listDocuments(id, { customerVisibleOnly: true }).catch((err) => {
      console.error(`[portal] documents for ${id} failed:`, err);
      return null;
    }),
  ]);
  if (!project) notFound();
  const right = access.kind === "staff" ? <StaffNav href={`/ops/projects/${id}`} /> : <CustomerNav />;

  const groups = GROUPS.map((g) => ({ ...g, docs: (docs ?? []).filter((d) => g.kinds.includes(d.kind)) })).filter((g) => g.docs.length > 0);

  return (
    <PortalShell right={right} width="narrow">
      <Link href={`/p/${id}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900">
        <span aria-hidden>←</span> Back to your project
      </Link>
      <h1 className="font-display text-3xl leading-tight text-ink-900 sm:text-4xl">Your documents</h1>
      <p className="mt-1.5 text-[15px] text-ink-500">
        {project.customer.addressLine}, {project.customer.postcode}. Open any of them to read, save as a PDF or print.
      </p>
      {access.kind === "staff" && (
        <p className="mt-4 rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 text-sm text-sage-900">
          Staff view: these are the documents the customer can see. Drafts and internal documents are in the command centre.
        </p>
      )}

      {docs === null ? (
        <p role="alert" className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          We couldn&apos;t load your documents just now. Please try again in a moment, or call us on {settings.company.phone}.
        </p>
      ) : groups.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
          <p className="font-semibold text-ink-900">No documents yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
            Your survey report, proposal, contract, invoices, certificates and handover pack will all appear here as they&apos;re issued.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map((g) => (
            <section key={g.title} aria-labelledby={`g-${g.kinds[0]}`}>
              <h2 id={`g-${g.kinds[0]}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
                {g.title}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">
                {g.docs.map((d: DocumentRecord) => (
                  <li key={d.id}>
                    <Link href={`/d/${d.id}`} className="flex min-h-16 items-center justify-between gap-4 px-5 py-3 hover:bg-surface/50">
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink-900">{d.title}</span>
                        <span className="block text-sm text-ink-500">
                          {DOCUMENT_KIND_LABEL[d.kind]} · {fmtDate(d.createdAt)} · {d.ref}
                        </span>
                      </span>
                      <span aria-hidden className="text-ink-500">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
