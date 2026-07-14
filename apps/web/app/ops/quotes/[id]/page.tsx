import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";
import type { QuoteResult, Survey, SurveyPhoto } from "@aircon/domain";
import { gbp } from "@/lib/format";
import { PREFERRED_START_LABEL, type BookingRequest } from "@/components/quote/booking-panel";
import { PHOTO_BUCKET, getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Quote detail — ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function OpsQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceClient();
  if (!supabase) notFound();

  const { data: q } = await supabase.from("quote_requests").select("*").eq("id", id).single();
  if (!q) notFound();

  const survey = q.survey as Survey;
  const quote = q.quote as QuoteResult;
  const booking = (q.booking as BookingRequest | null) ?? null;

  // Signed URLs for every uploaded photo (1 hour).
  const allPhotos: { owner: string; photo: SurveyPhoto }[] = [
    ...survey.rooms.flatMap((r) => r.photos.map((photo) => ({ owner: r.name, photo }))),
    ...survey.outdoor.photos.map((photo) => ({ owner: "Outdoor unit", photo })),
    ...survey.electrics.photos.map((photo) => ({ owner: "Fuse board", photo })),
  ].filter((p) => p.photo.storagePath);
  const paths = allPhotos.map((p) => p.photo.storagePath!);
  const signed =
    paths.length > 0
      ? (await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)).data ?? []
      : [];
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));

  async function setStatus(formData: FormData) {
    "use server";
    const status = formData.get("status");
    if (typeof status !== "string" || !["new", "reviewed", "booked", "declined"].includes(status))
      return;
    const sb = getServiceClient();
    if (!sb) return;
    await sb.from("quote_requests").update({ status }).eq("id", id);
    revalidatePath(`/ops/quotes/${id}`);
    revalidatePath("/ops/quotes");
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/ops/quotes" className="text-sm font-medium text-accent-700 hover:underline">
        ← All quote requests
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display">{q.customer_name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {survey.addressLine}, {q.postcode}
            {survey.geo?.district ? ` · ${survey.geo.district}` : ""} ·{" "}
            {new Date(q.created_at).toLocaleString("en-GB")}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            <a className="underline" href={`mailto:${q.email}`}>{q.email}</a>
            {q.phone ? ` · ${q.phone}` : ""} · wants install: {q.timeframe}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold">{gbp(q.total_gbp)}</p>
          <p className="text-sm text-ink-500">
            {q.confidence_score}/100 ({q.confidence_band}) · engine {q.engine_version}
          </p>
          <p className="mt-1 text-xs">
            <Link href={`/q/${q.id}`} className="text-accent-700 underline">
              customer view ↗
            </Link>
          </p>
        </div>
      </div>

      {/* Status */}
      <form action={setStatus} className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Status: {q.status}</span>
        {["new", "reviewed", "booked", "declined"]
          .filter((s) => s !== q.status)
          .map((s) => (
            <button
              key={s}
              name="status"
              value={s}
              className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-700 transition hover:bg-surface"
            >
              mark {s}
            </button>
          ))}
      </form>

      {booking && (
        <div className="mt-6 rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm">
          <p className="font-bold text-sage-700">Booking requested</p>
          <p className="mt-1">
            Preferred start: {PREFERRED_START_LABEL[booking.preferredStart]}
            {q.booked_at ? ` · requested ${new Date(q.booked_at).toLocaleString("en-GB")}` : ""}
          </p>
          {booking.notes && <p className="mt-1 text-ink-500">Notes: {booking.notes}</p>}
        </div>
      )}

      {/* Rooms */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">Survey — {survey.rooms.length} rooms</h2>
        <p className="mt-1 text-sm text-ink-500">
          {propertyLine(survey)}
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
                <th className="px-4 py-2.5">Room</th>
                <th className="px-4 py-2.5">Size</th>
                <th className="px-4 py-2.5">Floor</th>
                <th className="px-4 py-2.5">Glazing</th>
                <th className="px-4 py-2.5">Faces</th>
                <th className="px-4 py-2.5">Ext. wall</th>
                <th className="px-4 py-2.5">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {survey.rooms.map((room) => {
                const design = quote.systems.flatMap((s) => s.rooms).find((r) => r.roomId === room.id);
                return (
                  <tr key={room.id}>
                    <td className="px-4 py-2.5 font-medium">{room.name}</td>
                    <td className="px-4 py-2.5">{room.size}</td>
                    <td className="px-4 py-2.5">{room.floor}</td>
                    <td className="px-4 py-2.5">{room.glazing}</td>
                    <td className="px-4 py-2.5">{room.orientation}</td>
                    <td className="px-4 py-2.5">{room.hasExternalWall ? "yes" : "no"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {design ? `${design.capacityKw.toFixed(1)} kW (${design.estimatedLoadWatts} W est.)` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-ink-500">
          Outdoor: {survey.outdoor.location} · Electrics: {survey.electrics.condition}
        </p>
      </section>

      {/* Review flags */}
      {quote.reviewFlags.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-bold text-amber-800">Needs design review</p>
          <ul className="mt-1 list-disc pl-5 text-amber-800/90">
            {quote.reviewFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Photos */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">Photos ({allPhotos.length})</h2>
        {allPhotos.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No photos uploaded.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {allPhotos.map(({ owner, photo }) => {
              const url = urlByPath.get(photo.storagePath!);
              return (
                <figure key={photo.id} className="overflow-hidden rounded-2xl border border-line">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`${owner} — ${photo.kind}`} className="aspect-square w-full object-cover" />
                    </a>
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-xs text-ink-300">
                      unavailable
                    </div>
                  )}
                  <figcaption className="px-3 py-2 text-xs text-ink-500">
                    {owner} · {photo.kind}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </section>

      {/* Price lines */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">Price breakdown</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line text-sm">
          {quote.lines.map((line, i) => (
            <li key={i} className="flex justify-between gap-4 px-4 py-2.5">
              <span>{line.label}</span>
              <span className="font-semibold">{gbp(line.amount)}</span>
            </li>
          ))}
          <li className="flex justify-between px-4 py-2.5 font-bold">
            <span>Total (inc. VAT)</span>
            <span>{gbp(q.total_gbp)}</span>
          </li>
        </ul>
      </section>
    </main>
  );
}

function propertyLine(survey: Survey): string {
  const p = survey.property;
  return `${p.type}, built ${p.era}, ${p.bedrooms} bed, ${p.ownership === "owner" ? "owner-occupied" : "rented"}`;
}
