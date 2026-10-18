import type { CommsEventId } from "@aircon/domain";

/**
 * Messages that can't be switched off, and why: turning them off would
 * break sign-in or leave the contract record claiming a durable copy went
 * out when it didn't (CCR regs 10 and 12).
 */
export const ALWAYS_ON: Partial<Record<CommsEventId, string>> = {
  "magic-link": "nobody could sign in without it.",
  "proposal-issued": "it's the durable copy of the pre-contract information.",
  "proposal-accepted": "it's the customer's contract confirmation.",
};
