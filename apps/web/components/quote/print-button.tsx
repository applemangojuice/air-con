"use client";

import { secondaryBtn } from "./ui";

/** Keep a copy: print, or "Save as PDF" from the print dialog. */
export function PrintButton() {
  return (
    <div>
      <button type="button" onClick={() => window.print()} className={`${secondaryBtn} w-full text-sm`}>
        Print or save as PDF
      </button>
    </div>
  );
}
