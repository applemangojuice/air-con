import type { ProposalRecord } from "@aircon/domain";
import { versionedTable } from "./versioned";

/**
 * `proposals`: the customer proposal (ProposalRecord), one row per version.
 * An accepted proposal is the contract: the database refuses any change to
 * it except superseding (migration 0010 trigger; the local backend mirrors
 * it), so `update` on an accepted row throws unless it only supersedes.
 */

const table = versionedTable<ProposalRecord>("proposals", (p) => ({
  issued_at: p.issuedAt ?? null,
  accepted_at: p.acceptance?.at ?? null,
}));

export const { fromRow, toRow, get, listForProject, latestForProject, nextVersion, insert, update } = table;

/** The version in front of the customer: the newest issued or accepted one. */
export function liveForProject(projectId: string): Promise<ProposalRecord | null> {
  return table.latestForProject(projectId, { statuses: ["issued", "accepted"] });
}

/** The signed contract, if there is one. */
export function acceptedForProject(projectId: string): Promise<ProposalRecord | null> {
  return table.latestForProject(projectId, { statuses: ["accepted"] });
}
