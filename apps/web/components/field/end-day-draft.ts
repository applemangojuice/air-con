/**
 * The end-of-day sheet's two texts (the office summary and the customer's
 * update), kept apart from the sheet so the rule is tested on its own:
 *
 *  * opening the sheet fills both from the runsheet's defaults;
 *  * while the installer is still on the first screen, a field they haven't
 *    typed in follows the defaults (a photo syncing in can tick a step off,
 *    so "Done today" grows);
 *  * a field they've typed in is theirs: no sync, refresh or retry ever
 *    replaces it;
 *  * once they've moved on to the photos and the preview, nothing changes
 *    underneath them, so what's sent is what was previewed;
 *  * closing the sheet without sending (a stray tap) and opening it again
 *    keeps what they typed: only the untouched fields catch up.
 */

export interface EndDayTexts {
  summary: string;
  message: string;
}

export interface EndDayDraft extends EndDayTexts {
  touched: { summary: boolean; message: boolean };
}

export function openDraft(defaults: EndDayTexts): EndDayDraft {
  return { summary: defaults.summary, message: defaults.message, touched: { summary: false, message: false } };
}

/** The defaults changed (the outbox synced, the page refreshed): only untouched fields, only while still editable. */
export function followDefaults(draft: EndDayDraft, defaults: EndDayTexts, editable: boolean): EndDayDraft {
  if (!editable) return draft;
  const summary = draft.touched.summary ? draft.summary : defaults.summary;
  const message = draft.touched.message ? draft.message : defaults.message;
  return summary === draft.summary && message === draft.message ? draft : { ...draft, summary, message };
}

/** The installer typed in a field: it's theirs from now on. */
export function editDraft(draft: EndDayDraft, field: keyof EndDayTexts, value: string): EndDayDraft {
  return { ...draft, [field]: value, touched: { ...draft.touched, [field]: true } };
}

/** The sheet opened again on the same day without sending: what they typed stays, untouched fields catch up. */
export function reopenDraft(draft: EndDayDraft, defaults: EndDayTexts): EndDayDraft {
  return followDefaults(draft, defaults, true);
}

/** Has the installer typed anything of their own? */
export function isDirty(draft: EndDayDraft): boolean {
  return draft.touched.summary || draft.touched.message;
}
