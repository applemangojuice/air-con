"use client";

import { useEffect } from "react";
import { kickFieldOutbox } from "@/lib/field-outbox";

/**
 * Mounted once by the field layout: opening the app (or coming back to it
 * after a reload) sends anything still queued on the phone straight away,
 * past any backoff from a long dead spot, so the office sees it now.
 */
export function OutboxKick() {
  useEffect(() => {
    kickFieldOutbox();
  }, []);
  return null;
}
