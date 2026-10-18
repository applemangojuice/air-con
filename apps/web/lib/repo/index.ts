/**
 * The repositories, one namespace per table (contract §E/§F):
 *
 *   import { proposals, evidence } from "@/lib/repo";
 *   const live = await proposals.latestForProject(projectId);
 *
 * `messages` (the outbox's table) is maintained alongside lib/comms.
 */
export * as audit from "./audit";
export * as catalogue from "./catalogue";
export * as compatibility from "./compatibility";
export * as compliance from "./compliance";
export * as customers from "./customers";
export * as designs from "./designs";
export * as documents from "./documents";
export * as evidence from "./evidence";
export * as installJobs from "./installJobs";
export * as invoices from "./invoices";
export * as issues from "./issues";
export * as learnings from "./learnings";
export * as media from "./media";
export * as messages from "./messages";
export * as payments from "./payments";
export * as proposals from "./proposals";
export * as purchaseOrders from "./purchaseOrders";
export * as settings from "./settings";
export * as staff from "./staff";
export * as surveys from "./surveys";
export * as time from "./time";
export * as tokens from "./tokens";
