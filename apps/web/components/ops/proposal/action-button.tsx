"use client";

import { useState } from "react";
import { Button, type ButtonVariant } from "@/components/kit";
import { reviseAction, startDraftAction } from "@/app/ops/projects/[id]/proposal/actions";
import { reloadProposalPage } from "./reload";

/** Start a draft from the design, or revise an issued version: one tap, then the builder opens. */
export function ProposalActionButton({
  kind,
  projectId,
  proposalId,
  children,
  variant = "primary",
}: {
  kind: "start" | "revise";
  projectId: string;
  proposalId?: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = kind === "start" ? await startDraftAction(projectId) : await reviseAction(projectId, proposalId ?? "");
      if (r.ok) {
        // Stay busy: the page reloads into the builder (see reload.ts for why it's a full load).
        reloadProposalPage(projectId);
        return;
      }
      setError(r.error);
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <Button size="lg" variant={variant} onClick={go} busy={busy} busyLabel={kind === "start" ? "Starting…" : "Copying…"}>
        {children}
      </Button>
      <div aria-live="polite" role="status">
        {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      </div>
    </div>
  );
}
