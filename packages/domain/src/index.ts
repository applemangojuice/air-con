export * from "./types.ts";
export { canonicalJson, jsonbKeyOrder, sameJson } from "./json.ts";
export { estimateRoomLoadWatts, selectCapacityKw } from "./heatload.ts";
export { generateQuote, customerChecks, ENGINE_VERSION } from "./pricing.ts";
export { scoreConfidence } from "./confidence.ts";
export * from "./intelligence.ts";
export * from "./operations.ts";
export * from "./design.ts";
export * from "./install.ts";
export * from "./finance.ts";
export * from "./investor.ts";
export {
  LAYOUT_LABEL,
  buildDefaultConfig,
  type DefaultConfig,
  type DefaultConfigInput,
  type ExcludedRoom,
  type KitchenLivingLayout,
} from "./defaultconfig.ts";
export {
  ARCHETYPES,
  buildPresetRoom,
  getArchetype,
  getPermutation,
  permutationForLocation,
  suggestArchetypes,
  type HouseArchetype,
  type InstallPermutation,
  type RoomPreset,
} from "./archetypes.ts";

// Projects: v2 owns the plain names; the frozen v1 machine carries a V1
// suffix (see project-v1.ts). Shared, unchanged declarations (PrepItem,
// ElectricsPlanStatus, InstallerProfile, TimelineDateKind, daysBetween) are
// the same symbol through both.
export * from "./project.ts";
export * from "./project-v1.ts";

// Pilot platform modules (docs/pilot-architecture.md §D).
// Collision note: proposal.ts exports DEFAULT_PROPOSAL_ASSUMPTIONS (the
// contract's DEFAULT_ASSUMPTIONS), because intelligence.ts already exports
// DEFAULT_ASSUMPTIONS.
export * from "./settings.ts";
export * from "./staff.ts";
export * from "./survey-visit.ts";
export * from "./media.ts";
export * from "./catalogue.ts";
export * from "./design-record.ts";
export * from "./costing.ts";
export * from "./proposal.ts";
export * from "./compliance.ts";
export * from "./issues.ts";
export * from "./money.ts";
export * from "./accounts.ts";
export * from "./comms.ts";
export * from "./documents.ts";
export * from "./pilots.ts";
export * from "./purchasing.ts";
export * from "./working-days.ts";
