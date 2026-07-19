/** Skeleton while the project timeline loads from the database. */
export default function LoadingProject() {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          <div className="h-6 w-28 animate-pulse rounded-full bg-surface" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6" aria-busy>
        <div className="h-4 w-56 animate-pulse rounded-full bg-surface" />
        <div className="mt-6 h-24 animate-pulse rounded-3xl bg-surface" />
        <div className="mt-4 h-80 animate-pulse rounded-3xl bg-surface" />
        <p className="sr-only">Loading your installation timeline…</p>
      </main>
    </div>
  );
}
