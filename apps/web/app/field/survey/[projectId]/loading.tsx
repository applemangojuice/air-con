/** While the visit loads: the shape of the visit card, so nothing jumps. */
export default function LoadingSurvey() {
  return (
    <div aria-busy className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="h-4 w-32 animate-pulse rounded-full bg-surface" />
        <div className="mt-3 h-8 w-56 animate-pulse rounded-full bg-surface" />
        <div className="mt-3 h-5 w-40 animate-pulse rounded-full bg-surface" />
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="h-12 animate-pulse rounded-full bg-surface" />
          <div className="h-12 animate-pulse rounded-full bg-surface" />
        </div>
        <div className="mt-3 h-14 animate-pulse rounded-full bg-surface" />
      </div>
      <div className="h-48 animate-pulse rounded-2xl bg-surface" />
      <p className="sr-only">Loading the survey…</p>
    </div>
  );
}
