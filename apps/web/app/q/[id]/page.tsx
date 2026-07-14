import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { QuoteResult, Survey } from "@aircon/domain";
import { BookingPanel, type BookingRequest } from "@/components/quote/booking-panel";
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
    .select("id, customer_name, postcode, created_at, survey, quote, booking")
    .eq("id", id)
    .single();
  if (!data) notFound();

  const survey = data.survey as Survey;
  const quote = data.quote as QuoteResult;
  const booking = (data.booking as BookingRequest | null) ?? null;
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
      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-8 sm:px-0">
        <p className="mb-4 text-sm text-ink-500">
          {data.customer_name} · {survey.addressLine}, {survey.postcode} · prepared {created}
        </p>
        <QuoteView quote={quote} roomCount={survey.rooms.length} />
        <BookingPanel
          quoteId={data.id}
          installDays={quote.installDays}
          postcode={survey.postcode}
          initialBooking={booking}
        />
      </main>
    </div>
  );
}
