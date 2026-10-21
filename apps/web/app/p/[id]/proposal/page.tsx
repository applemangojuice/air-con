import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { EARLY_START_WORDING_VERSION, can, cancellationCopy, cancellationSentence, earlyStartWording, guaranteeLines, performanceCommitment } from "@aircon/domain";
import { Logo } from "@/components/site/logo";
import { realPhone } from "@/components/site/claims";
import { ProposalView } from "@/components/proposal/proposal-view";
import { earliestStartNote, extraCharges, paymentTerms, proposalNotReady, vatNote } from "@/components/proposal/copy";
import { CustomerNav, StaffNav } from "@/components/portal/shell";
import type { ProposalPageData } from "@/components/proposal/types";
import { getSession, requireProjectAccess } from "@/lib/auth/server";
import { emailConfigured } from "@/lib/email";
import { cancellationForm, cancellationInstructions } from "@/lib/comms/legal-text";
import { loadProject } from "@/lib/project-service";
import { loadCustomerProposal } from "@/lib/proposal-server";

export const metadata: Metadata = {
  title: "Your proposal",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ firstName, nav, children }: { firstName?: string; nav?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line bg-cream/90">
        <div className="mx-auto flex min-h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="Dang, It's Hot: home" className="shrink-0 rounded-full">
            <Logo />
          </Link>
          {nav ? (
            <div className="flex min-w-0 items-center gap-1 text-sm">{nav}</div>
          ) : (
            firstName && <span className="truncate text-sm font-medium text-ink-500">{firstName}&apos;s proposal</span>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-32 pt-6 sm:px-6 sm:pb-20 sm:pt-10">{children}</main>
    </div>
  );
}

function Notice({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-white px-6 py-10 text-center sm:px-10">
      <h1 className="font-display text-3xl text-ink-900">{title}</h1>
      <div className="mx-auto mt-3 max-w-md text-base text-ink-700">{body}</div>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * The customer's proposal at /p/<projectId>/proposal. The project's
 * customer (or staff on the job) only; anyone else gets a 404. Staff with
 * proposal.edit can preview any version with ?preview=<proposalId>.
 */
export default async function CustomerProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const { preview } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const session = await getSession();
  if (!session) {
    return (
      <Shell>
        <Notice
          title="Sign in to see your proposal"
          body={
            <p>
              For your privacy, your proposal opens from the link in our emails. Your link may have expired: ask for a fresh one and
              we&apos;ll email it to you straight away.
            </p>
          }
          action={
            // /portal is the customer sign-in (magic link, F1) and honours ?next.
            <Link
              href={`/portal?next=${encodeURIComponent(`/p/${id}/proposal`)}`}
              className="inline-flex min-h-12 items-center rounded-full bg-accent-700 px-6 text-base font-semibold text-white hover:bg-accent-800"
            >
              Email me a sign-in link
            </Link>
          }
        />
      </Shell>
    );
  }

  const access = await requireProjectAccess(id, { allowCustomer: true, customerSide: true });
  if (!access) notFound();
  const previewId = preview && UUID_RE.test(preview) && access.kind === "staff" && can(access.staff, "proposal.edit") ? preview : undefined;
  const loaded = await loadCustomerProposal(id, previewId ? { previewId } : {});

  if (!loaded) {
    const project = await loadProject(id);
    const copy = project
      ? proposalNotReady(project)
      : { title: "Your proposal isn't ready yet", body: "We'll email you as soon as your proposal is ready." };
    return (
      <Shell
        nav={access.kind === "staff" ? <StaffNav href={`/ops/projects/${id}`} /> : <CustomerNav />}
      >
        <Notice
          title={copy.title}
          body={<p>{copy.body}</p>}
          action={
            project?.survey.status === "not-booked" ? (
              <Link href={`/p/${id}`} className="inline-flex min-h-12 items-center rounded-full bg-accent-700 px-6 text-base font-semibold text-white hover:bg-accent-800">
                Book your survey
              </Link>
            ) : (
              <Link href={`/p/${id}`} className="inline-flex min-h-12 items-center rounded-full border border-line bg-white px-6 text-base font-semibold text-ink-900 hover:bg-surface">
                Back to your project
              </Link>
            )
          }
        />
      </Shell>
    );
  }

  const { project, proposal, settings, today } = loaded;
  const contractType = proposal.contractType ?? project.proposal.contractType ?? "supply-and-install";
  const company = settings.company;
  const trader = {
    legalName: company.legalName,
    tradingName: company.tradingName,
    geographicAddress: company.geographicAddress,
    ...(company.registeredAddress ? { registeredAddress: company.registeredAddress } : {}),
    ...(realPhone(company.phone) ? { phone: realPhone(company.phone)! } : {}),
    email: company.email,
  };
  const firstName = project.customer.name.replace(/\s*\(DEMO\)\s*$/i, "").trim().split(/\s+/)[0] ?? "";
  const a = proposal.acceptance;
  const pp = project.proposal;
  const accepted =
    loaded.state === "accepted" && a
      ? {
          optionId: a.optionId,
          optionLabel: a.optionLabel,
          totalPence: a.totalPence,
          at: a.at,
          name: a.name,
          earlyStartRequested: a.earlyStartRequested,
          earlyStartEvidenced: Boolean(pp.earlyStart?.evidencedAt),
          cancellation: cancellationCopy(project, { settings, today }),
          ...(pp.confirmationSentAt ? { confirmationSentAt: pp.confirmationSentAt } : {}),
        }
      : undefined;

  const data: ProposalPageData = {
    proposalId: proposal.id,
    projectId: project.id,
    version: proposal.version,
    ...(loaded.documents.proposal && !previewId ? { ref: loaded.documents.proposal.ref } : {}),
    state: loaded.state,
    ...((loaded.state === "open" || loaded.state === "changes-requested") && !previewId && pp.proposalId === proposal.id && !pp.preContractInfoSentAt
      ? { infoPending: true }
      : {}),
    viewer: previewId ? "preview" : access.kind === "staff" ? "staff" : "customer",
    ...(emailConfigured() ? {} : { emailDemo: true }),
    documentHash: loaded.documentHash,
    firstName,
    place: project.customer.addressLine || (project.customer.postcode ? `your home in ${project.customer.postcode}` : "your home"),
    ...(project.customer.email ? { email: project.customer.email } : {}),
    options: proposal.options,
    inclusions: proposal.inclusions,
    exclusions: proposal.exclusions,
    assumptions: proposal.assumptions,
    ...(proposal.planningNote ? { planningNote: proposal.planningNote } : {}),
    guarantees: proposal.guarantees?.length ? proposal.guarantees : guaranteeLines(settings, proposal.warranty),
    validUntil: proposal.validUntil,
    ...(proposal.increaseReason ? { increaseReason: proposal.increaseReason } : {}),
    instantPricePence: Math.round((proposal.instantPriceGbp || 0) * 100),
    contractType,
    termsVersion: proposal.termsVersion,
    ...(proposal.termsText?.length ? { termsText: proposal.termsText } : {}),
    media: loaded.media,
    ...(loaded.approvedBy ? { approvedBy: loaded.approvedBy } : {}),
    foundingPilot: loaded.foundingPilot,
    vatRegistered: settings.tax.vatRegistered,
    company: { tradingName: company.tradingName, legalName: company.legalName, phone: realPhone(company.phone), email: company.email },
    vatNotes: Object.fromEntries(proposal.options.map((o) => [o.id, vatNote(o.pricing, settings)])),
    paymentTerms: Object.fromEntries(proposal.options.map((o) => [o.id, paymentTerms(o.pricing.totalPence, settings)])),
    extraCharges: extraCharges(),
    earliestStart: earliestStartNote(contractType, settings, today),
    performance: performanceCommitment(settings.scheduling.installWithinWeeks),
    cancellation: {
      summary: cancellationSentence({ accepted: false, contractType }, settings.scheduling.cancellationDays),
      days: settings.scheduling.cancellationDays,
      instructions: cancellationInstructions(trader, { contractType, days: settings.scheduling.cancellationDays }),
      form: cancellationForm(trader),
      reviewed: settings.legal.cancellationReviewed,
    },
    earlyStart: { wording: earlyStartWording(contractType), wordingVersion: EARLY_START_WORDING_VERSION },
    documents: previewId ? {} : loaded.documents,
    ...(accepted ? { accepted } : {}),
    ...(pp.changeRequest || proposal.changeRequest ? { changeRequest: proposal.changeRequest ?? pp.changeRequest } : {}),
    ...(pp.declineReason || proposal.declinedReason ? { declineReason: proposal.declinedReason ?? pp.declineReason } : {}),
  };

  return (
    <Shell firstName={firstName}>
      <ProposalView data={data} />
    </Shell>
  );
}
