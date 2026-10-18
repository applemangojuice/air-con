/** While the proposal loads: the page's shape, quietly. */
export default function Loading() {
  return (
    <div className="min-h-dvh bg-cream" aria-busy="true" aria-live="polite">
      <div className="h-14 border-b border-line" />
      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-10 sm:px-6">
        <p className="sr-only">Loading your proposal…</p>
        <div className="h-80 animate-pulse rounded-3xl bg-surface" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
      </div>
    </div>
  );
}
