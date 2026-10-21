import type { DesignRecord } from "@aircon/domain";
import { versionedTable } from "./versioned";

/**
 * `designs`: the engineered design (DesignRecord), one row per version. The
 * approved version is what the proposal, purchase orders and runsheet are
 * built from.
 */

const table = versionedTable<DesignRecord>("designs");

export const { fromRow, toRow, get, listForProject, latestForProject, nextVersion, insert, update } = table;

/** The newest approved version, or null until a technical lead signs one. */
export function approvedForProject(projectId: string): Promise<DesignRecord | null> {
  return table.latestForProject(projectId, { statuses: ["approved"] });
}
