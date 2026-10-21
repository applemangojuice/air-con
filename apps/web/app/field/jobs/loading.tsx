/** While a job loads: the shape of the page, so nothing jumps. */
export default function FieldJobsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-11 w-3/4 rounded-full bg-surface" />
      <div className="h-8 w-1/2 rounded-full bg-surface" />
      <div className="h-40 rounded-3xl bg-white" />
      <div className="h-24 rounded-3xl bg-white" />
      <div className="h-24 rounded-3xl bg-white" />
    </div>
  );
}
