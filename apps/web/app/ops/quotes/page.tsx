import Link from "next/link";
import type { Metadata } from "next";
import { gbp } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Quote requests · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  new: "bg-accent-100 text-accent-700",
  reviewed: "bg-surface text-ink-500",
  booked: "bg-sage-100 text-sage-700",
  declined: "bg-red-50 text-red-600",
};

export default async function OpsQuotesPage() {
  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <Shell>
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
          <p className="font-semibold text-ink-900">Demo mode, no database connected</p>
          <p className="mt-2">
            Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to see
            customer quote requests here. Set <code>OPS_PASSWORD</code> to protect this page.
          </p>
        </div>
      </Shell>
    );
  }

  const { data: quotes, error } = await supabase
    .from("quote_requests")
    .select(
      "id, created_at, customer_name, email, postcode, total_gbp, room_count, confidence_score, confidence_band, status, timeframe",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-red-600">Failed to load quotes: {error.message}</p>
      </Shell>
    );
  }

  return (
    <Shell count={quotes.length}>
      {quotes.length === 0 ? (
        <p className="text-sm text-ink-500">No quote requests yet. Share the funnel link.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Postcode</th>
                <th className="px-4 py-3">Rooms</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Timeframe</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-surface/50">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {new Date(q.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/ops/quotes/${q.id}`} className="font-semibold text-accent-700 hover:underline">
                      {q.customer_name}
                    </Link>
                    <span className="block text-xs text-ink-300">{q.email}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{q.postcode}</td>
                  <td className="px-4 py-3">{q.room_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{gbp(q.total_gbp)}</td>
                  <td className="px-4 py-3">
                    {q.confidence_score}/100{" "}
                    <span className="text-xs text-ink-300">({q.confidence_band})</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">{q.timeframe}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[q.status] ?? "bg-surface text-ink-500"}`}
                    >
                      {q.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Quote requests</h1>
          <p className="mt-1 text-sm text-ink-500">
            {count !== undefined ? `${count} received` : "Customer self-survey submissions"}
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>
      {children}
    </main>
  );
}
