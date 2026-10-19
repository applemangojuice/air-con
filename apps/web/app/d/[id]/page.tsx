import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  documentCompany,
  documentCustomer,
  type CertificateSnapshot,
  type CommissioningCertificateSnapshot,
  type ContractSnapshot,
  type DocumentHeader,
  type DocumentRecord,
  type HandoverPackSnapshot,
  type InvoiceSnapshot,
  type ProposalSnapshot,
  type ReceiptSnapshot,
  type SurveyReportSnapshot,
  type VariationSnapshot,
} from "@aircon/domain";
import {
  CertificateDoc,
  CommissioningDoc,
  ContractDoc,
  HandoverPackDoc,
  InvoiceDoc,
  ProposalDoc,
  ReceiptDoc,
  SurveyReportDoc,
  VariationDoc,
  type DocContext,
} from "@/components/docs/kinds";
import { DocSheet, DocToolbar } from "@/components/docs/shell";
import { CustomerNav, PortalShell, StaffNav } from "@/components/portal/shell";
import { LinkRequest } from "@/components/portal/sign-in";
import { requireProjectAccess } from "@/lib/auth/server";
import { getDocument, isCustomerVisible } from "@/lib/documents-server";
import { documentPhotos } from "@/lib/portal-server";
import { loadProject } from "@/lib/project-service";
import { getSettings } from "@/lib/settings-server";
import { reachUs, realPhone } from "@/components/site/claims";

export const metadata: Metadata = {
  title: "Your document",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One printable document (contract §G F1): the project's customer, for a
 * customer-visible, issued document; or a team member who can see the
 * project (drafts and superseded versions included, watermarked). Anyone
 * else gets the same sign-in page whether or not the document exists.
 * "Download PDF" is the browser's print, on A4 print styles.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  if (!UUID_RE.test(rawId)) notFound();
  const id = rawId.toLowerCase();
  const settings = await getSettings();

  let doc: DocumentRecord | null = null;
  try {
    doc = await getDocument(id);
  } catch (err) {
    console.error(`[documents] ${id} failed to load:`, err);
    return (
      <PortalShell width="narrow">
        <div role="alert" className="rounded-3xl border border-line bg-white p-6 sm:p-8">
          <h1 className="font-display text-2xl text-ink-900">We couldn&apos;t open this document just now</h1>
          <p className="mt-2 text-[15px] text-ink-700">Please try again in a moment, or {reachUs(settings.company)}.</p>
        </div>
      </PortalShell>
    );
  }
  const access = doc ? await requireProjectAccess(doc.projectId, { allowCustomer: true }) : null;
  const allowed = doc && access && (access.kind === "staff" || isCustomerVisible(doc));

  if (!doc || !access || !allowed) {
    return (
      <PortalShell width="narrow">
        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold text-accent-700">Your documents</p>
          <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900">Sign in to see this document</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
            Your documents are private. We&apos;ll email a sign-in link to the address we have for this project. If you&apos;re signed in with a different email, sign out
            first.
          </p>
          <div className="mt-6">
            <LinkRequest target={{ documentId: id }} phone={realPhone(settings.company.phone)} email={settings.company.email} />
          </div>
        </div>
      </PortalShell>
    );
  }

  const [project, media] = await Promise.all([loadProject(doc.projectId), documentPhotos(doc)]);
  const header = (doc.snapshot ?? {}) as Partial<DocumentHeader>;
  const company = header.company ?? documentCompany(settings);
  const customer = header.customer ?? (project ? documentCustomer(project) : { name: "", addressLine: "", postcode: "" });
  const ctx: DocContext = {
    photos: media.photos,
    asBuilt: media.asBuilt,
    legal: { termsReviewed: settings.legal.termsReviewed, cancellationReviewed: settings.legal.cancellationReviewed, termsVersion: settings.legal.termsVersion },
    company: {
      legalName: company.legalName,
      tradingName: company.tradingName,
      geographicAddress: company.geographicAddress ?? settings.company.geographicAddress,
      ...(settings.company.registeredAddress ? { registeredAddress: settings.company.registeredAddress } : {}),
      phone: company.phone,
      email: company.email,
      complaintsProcess: settings.company.complaintsProcess,
      ...(settings.company.adr ? { adr: settings.company.adr } : {}),
      ...(settings.company.workmanshipGuarantee ? { workmanshipGuarantee: settings.company.workmanshipGuarantee } : {}),
    },
    payments: {
      depositPct: settings.payments.depositPct,
      depositTiming: settings.payments.depositTiming,
      balanceDueDays: settings.payments.balanceDueDays,
      methods: settings.payments.methods,
    },
    cancellationDays: settings.scheduling.cancellationDays,
    docHref: (target) => `/d/${target}`,
    live: project
      ? {
          electricalCert: project.handover.electricalCert,
          ...(project.handover.electricalCertDocumentId ? { electricalCertDocumentId: project.handover.electricalCertDocumentId } : {}),
          warrantyRegistered: project.handover.warrantyRegistered,
          ...(project.handover.warrantyDocumentId ? { warrantyDocumentId: project.handover.warrantyDocumentId } : {}),
          ...(project.aftercare.serviceDueOn ? { serviceDueOn: project.aftercare.serviceDueOn } : {}),
          projectHref: `/p/${project.id}`,
        }
      : undefined,
  };

  const snap = doc.snapshot;
  let body: ReactNode;
  switch (doc.kind) {
    case "proposal":
      body = <ProposalDoc snap={snap as ProposalSnapshot} ctx={ctx} />;
      break;
    case "contract":
      body = <ContractDoc snap={snap as ContractSnapshot} ctx={ctx} />;
      break;
    case "variation":
      body = <VariationDoc snap={snap as VariationSnapshot} />;
      break;
    case "invoice":
      body = <InvoiceDoc snap={snap as InvoiceSnapshot} />;
      break;
    case "receipt":
      body = <ReceiptDoc snap={snap as ReceiptSnapshot} />;
      break;
    case "commissioning-certificate":
      body = <CommissioningDoc snap={snap as CommissioningCertificateSnapshot} />;
      break;
    case "handover-pack":
      body = <HandoverPackDoc snap={snap as HandoverPackSnapshot} ctx={ctx} />;
      break;
    case "survey-report":
      body = <SurveyReportDoc snap={snap as SurveyReportSnapshot} ctx={ctx} />;
      break;
    case "certificate":
      body = <CertificateDoc snap={snap as CertificateSnapshot} ctx={ctx} />;
      break;
  }

  const back =
    access.kind === "staff"
      ? { href: `/ops/projects/${doc.projectId}`, label: "Back to the command centre" }
      : { href: `/p/${doc.projectId}/documents`, label: "All your documents" };

  return (
    <PortalShell right={access.kind === "staff" ? <StaffNav href={`/ops/projects/${doc.projectId}`} /> : <CustomerNav />}>
      <DocToolbar back={back} />
      <DocSheet doc={doc} company={company} customer={customer} issuedAt={header.issuedAt ?? doc.createdAt}>
        {wellFormed(doc) ? (
          body
        ) : (
          <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This document&apos;s contents can&apos;t be displayed. Please {reachUs(settings.company)} and we&apos;ll send you a copy.
          </p>
        )}
      </DocSheet>
    </PortalShell>
  );
}

/** Just enough of each snapshot to render, so a malformed record shows a calm message, not an error page. */
function wellFormed(doc: DocumentRecord): boolean {
  const s = (doc.snapshot ?? {}) as Record<string, unknown>;
  const obj = (v: unknown) => typeof v === "object" && v !== null;
  const arr = (v: unknown) => Array.isArray(v);
  switch (doc.kind) {
    case "proposal":
      return obj(s.proposal) && arr((s.proposal as { options?: unknown }).options);
    case "contract":
      return obj(s.option) && obj(s.acceptance) && obj(s.cancellation) && arr(s.inclusions) && arr(s.exclusions) && arr(s.assumptions);
    case "variation":
      return obj(s.issue) && obj((s.issue as { variation?: unknown }).variation);
    case "invoice":
      return obj(s.invoice) && arr((s.invoice as { lines?: unknown }).lines) && arr(s.payments);
    case "receipt":
      return obj(s.payment);
    case "commissioning-certificate":
      return obj(s.commissioning) && arr((s.commissioning as { results?: unknown }).results) && arr(s.equipment);
    case "handover-pack":
      return (
        obj(s.commissioning) &&
        arr(s.equipment) &&
        arr(s.documents) &&
        arr(s.fgas) &&
        arr(s.care) &&
        arr(s.contacts) &&
        obj(s.warranty) &&
        obj(s.electricalCert) &&
        obj(s.maintenanceInfo)
      );
    case "survey-report":
      return obj(s.survey) && obj((s.survey as { data?: unknown }).data) && arr(s.promises);
    case "certificate":
      return obj(s.certificate) && arr((s.certificate as { mediaIds?: unknown }).mediaIds);
  }
}
