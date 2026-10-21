import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { QuoteResult, Survey } from "@aircon/domain";
import { BookSurveyButton } from "@/components/quote/book-survey";
import { JourneyStrip } from "@/components/quote/journey-strip";
import { LegalLinks } from "@/components/quote/legal-links";
import { PrintButton } from "@/components/quote/print-button";
import { QuoteView } from "@/components/quote/quote-view";
import { ShareQuoteButton } from "@/components/quote/share-button";
import {
  coverageFor,
  installDurationCopy,
  surveyDurationCopy,
  surveyPriceCopy,
  validUntil,
  vatCopy,
} from "@/components/site/claims";
import { Logo } from "@/components/site/logo";
import { appUrl } from "@/lib/brand";
import { fmtDate } from "@/lib/format";
import { getPublicSettings } from "@/lib/public-settings";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Your quote",
  robots: { index: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The saved quote: the permanent link the funnel lands on and the quote
 * email points to. It answers what happened (the price, saved), what happens
 * next (a home survey), and gives the one action: Book my home survey.
 * Unguessable id, not indexed; drafts and out-of-area leads have no page.
 */
export default async function SavedQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; emailed?: string }>;
}) {
  const [{ id }, sp, settings] = await Promise.all([params, searchParams, getPublicSettings()]);
  if (!UUID_RE.test(id)) notFound();

  const supabase = getServiceClient();
  if (!supabase) notFound(); // demo mode has no saved quotes

  const { data } = await supabase
    .from("quote_requests")
    .select("id, customer_name, postcode, created_at, survey, quote, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status === "draft") notFound();
  const survey = data.survey as Survey;
  const quote = data.quote as QuoteResult;
  if (!survey || !quote || !Array.isArray(survey.rooms) || survey.rooms.length === 0) notFound();

  const { data: projectRow } = await supabase.from("projects").select("id").eq("quote_id", id).maybeSingle();

  const createdAt = String(data.created_at);
  const until = validUntil(settings, createdAt);
  const today = new Date().toISOString().slice(0, 10);
  const expired = until < today;
  const coverage = coverageFor(settings.serviceArea, String(data.postcode ?? survey.postcode));
  const firstName = String(data.customer_name ?? "").trim().split(/\s+/)[0] ?? "";
  const justSaved = sp.saved === "1";
  const vat = vatCopy(settings);

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4 sm:px-0">
          <Link href="/" aria-label="Dang, It's Hot home page">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-ink-500">Quote ref {data.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>
      <main className="print-exact mx-auto w-full max-w-xl px-4 pb-16 pt-6 sm:px-0 print:pb-8">
        <div className="no-print mb-6">
          <JourneyStrip current={projectRow ? "survey" : "price"} />
        </div>

        {justSaved && (
          <div role="status" className="no-print mb-5 rounded-sm border border-sage-200 bg-sage-50 px-4 py-3 text-sm text-sage-900">
            <p className="font-semibold">Your quote is saved.</p>
            <p className="mt-0.5">
              {sp.emailed === "1"
                ? "A copy is on its way to your inbox. This page is its permanent home, so you can come back any time."
                : "This page is its permanent home: bookmark it to come back any time."}
            </p>
          </div>
        )}

        <h1 className="text-2xl font-display sm:text-3xl">
          {firstName ? `${firstName}, here's your price` : "Here's your price"}
        </h1>
        <p className="mb-5 mt-1 text-sm text-ink-500">
          {survey.addressLine}, {survey.postcode} · given {fmtDate(createdAt)}
        </p>

        <QuoteView
          quote={quote}
          roomCount={survey.rooms.length}
          settings={settings}
          createdAt={createdAt}
          afterHero={
            <>
              {expired && (
                <p className="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  This price was valid until {fmtDate(until)}. Book a survey and we&apos;ll confirm today&apos;s price
                  for your home in your proposal.
                </p>
              )}
              {coverage.covered || projectRow ? (
                <BookSurveyButton
                  quoteId={data.id}
                  existingProjectId={(projectRow?.id as string | undefined) ?? null}
                  surveyPrice={surveyPriceCopy(settings)}
                  surveyDuration={surveyDurationCopy(settings)}
                />
              ) : (
                <section className="rounded-sm border border-line bg-white p-6">
                  <h2 className="text-lg font-bold">We&apos;re not installing in {coverage.outcode} at the moment</h2>
                  <p className="mt-2 text-sm text-ink-700">
                    So we can&apos;t book a survey there yet. Email{" "}
                    <a href={`mailto:${settings.company.email}`} className="font-semibold text-accent-700 underline">
                      {settings.company.email}
                    </a>{" "}
                    and we&apos;ll tell you when that changes.
                  </p>
                </section>
              )}
            </>
          }
        />

        <div className="no-print mt-8 grid gap-3 sm:grid-cols-2">
          <ShareQuoteButton quoteId={data.id} />
          <PrintButton />
        </div>

        <section className="mt-10 border-t border-line pt-6 text-sm text-ink-700" aria-labelledby="what-next">
          <h2 id="what-next" className="font-bold text-ink-900">
            What happens after the survey
          </h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5">
            <li>We design your system on photos of your own rooms, and a qualified engineer signs it off.</li>
            <li>Your proposal sets out the price in writing, what&apos;s included, and your right to cancel.</li>
            <li>You choose your install dates. {installDurationCopy(settings)}, commissioned in heating and cooling.</li>
          </ol>
          <p className="mt-4">
            Questions? Email{" "}
            <a href={`mailto:${settings.company.email}`} className="font-semibold text-accent-700 underline-offset-2 hover:underline">
              {settings.company.email}
            </a>
            {settings.company.phone ? ` or call ${settings.company.phone}` : ""}.
          </p>
        </section>

        <LegalLinks className="mt-8" />

        {/* Print-only provenance so a PDF stands on its own. */}
        <p className="mt-8 hidden border-t border-line pt-4 text-xs text-ink-500 print:block">
          Price from {settings.company.tradingName} · quote ref {data.id.slice(0, 8).toUpperCase()} · given{" "}
          {fmtDate(createdAt)} · valid until {fmtDate(until)}
          {vat.short ? ` · ${vat.short}` : ""}. Confirmed at your home survey. Online at {`${appUrl()}/q/${data.id}`}
        </p>
      </main>
    </div>
  );
}
