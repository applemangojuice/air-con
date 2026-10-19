"use client";

import { useEffect } from "react";
import { getFieldOutbox } from "@/lib/field-outbox";

/**
 * Tells the phone's outbox who's signed in (every field page renders one,
 * or calls useFieldIdentity): new captures are stamped with this person,
 * and only their own captures send, so nothing queued before a sign-out
 * goes under the next person's name.
 */
export function useFieldIdentity(me: { id: string; name: string } | null | undefined): void {
  const id = me?.id;
  const name = me?.name;
  useEffect(() => {
    if (id && name !== undefined) getFieldOutbox().setSignedIn({ id, name });
  }, [id, name]);
}

export function FieldIdentity({ id, name }: { id: string; name: string }) {
  useFieldIdentity({ id, name });
  return null;
}
