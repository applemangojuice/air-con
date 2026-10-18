/** Skeleton while the hub loads from the database. */
export default function LoadingProject() {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center px-4 sm:px-6">
          <div className="h-8 w-36 animate-pulse rounded-full bg-surface" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10" aria-busy="true">
        <div className="h-4 w-28 animate-pulse rounded-full bg-surface" />
        <div className="mt-3 h-9 w-full max-w-md animate-pulse rounded-full bg-surface" />
        <div className="mt-8 h-44 animate-pulse rounded-3xl bg-surface" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
        <p className="sr-only" role="status">
          Loading your project…
        </p>
      </main>
    </div>
  );
}
