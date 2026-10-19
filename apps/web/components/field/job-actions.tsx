"use client";

import { QuickActions } from "./quick-actions";
import type { FieldJob } from "./types";
import { useMergedJob } from "./use-outbox";

/**
 * The floating Actions button on a job's other screens (the pack,
 * commissioning, handover), so On my way, Raise an issue, Call, Pause and
 * End day are one tap away wherever the installer is, as on the runsheet.
 */
export function JobActions({ data }: { data: FieldJob }) {
  const merged = useMergedJob(data.job, data.me);
  if (data.header.bookingStatus !== "booked") return null;
  const day = data.header.currentDay ?? data.header.nextDay ?? data.header.totalDays;
  return (
    <>
      {/* Room under the floating button, so the last thing on the page is never hidden behind it. */}
      <div aria-hidden className="h-16" />
      <QuickActions data={data} merged={merged} day={day} />
    </>
  );
}
