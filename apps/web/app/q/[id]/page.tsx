import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { QuoteResult, Survey } from "@aircon/domain";
import { StartProjectPanel } from "@/components/project/start-project";
import { QuoteView } from "@/components/quote/quote-view";
import { Logo } from "@/components/site/logo";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Your quote",
  robots: { index: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SavedQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = getServiceClient();
  if (!supabase) notFound(); // demo mode has no saved quotes

  const { data } = await supabase
    .from("quote_requests")
    .select("id, customer_name, postcode, created_at, survey, quote")
    .eq("id", id)
    .single();
  if (!data) notFound();

  const { data: projectRow } = await supabase
    .from("projects")
    .select("id")
    .eq("quote_id", id)
    .maybeSingle();

  const survey = data.survey as Survey;
  const quote = data.quote as QuoteResult;
  const created = new Date(data.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4 sm:px-0">
          <Link href="/" aria-label="Back to homepage">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-ink-300">
            Quote ref {data.id.slice(0, 8)}
          </span>
        </div>
      </header>
      <main className="print-exact mx-auto w-full max-w-xl px-4 pb-24 pt-8 sm:px-0 print:pb-8">
        <p className="mb-4 text-sm text-ink-500">
          {data.customer_name} · {survey.addressLine}, {survey.postcode} · prepared {created}
        </p>
        <QuoteView quote={quote} roomCount={survey.rooms.length} />
        {/* Interactive booking UI has no meaning on paper. */}
        <div className="no-print">
          <StartProjectPanel quoteId={data.id} existingProjectId={projectRow?.id ?? null} />
        </div>
        {/* Print-only provenance so a PDF stands on its own. */}
        <p className="mt-8 hidden border-t border-line pt-4 text-xs text-ink-500 print:block">
          Fixed-price quote by Dang, It&apos;s Hot · quote ref {data.id.slice(0, 8)} · VAT
          included · 5-year parts &amp; labour warranty. Saved online with finance options and
          booking at{" "}
          {`${(process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac").replace(/\/$/, "")}/q/${data.id}`}
        </p>
      </main>
    </div>
  );
}
