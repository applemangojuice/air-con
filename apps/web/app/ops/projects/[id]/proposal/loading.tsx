/** While the builder loads. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6" aria-busy="true">
      <p className="sr-only" role="status">
        Loading the proposal…
      </p>
      <div className="mb-8 h-20 w-72 animate-pulse rounded-2xl bg-surface" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="h-[32rem] animate-pulse rounded-2xl bg-surface" />
        <div className="h-80 animate-pulse rounded-2xl bg-surface" />
      </div>
    </main>
  );
}
