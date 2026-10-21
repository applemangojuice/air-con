import { isTextable, normaliseUkPhone } from "../providers/sms.ts";

/**
 * How the customer hears that the team (or the surveyor) is on the way:
 *
 *  * "sms": they gave a mobile that can take texts, and texts really go (or
 *    nothing does: demo mode, where every message is recorded, not sent);
 *  * "email": no mobile, or email is live while SMS isn't, so a text would
 *    never arrive;
 *  * null: neither, so nothing would reach them.
 *
 * The outbox sends the on-my-way events this way (COMMS_EVENTS fallback),
 * and every line that promises it ("We'll text you…") reads it, so the
 * promise is what actually happens. Pure.
 */
export type OnTheWayChannel = "sms" | "email" | null;

export function onTheWayChannel(to: { phone?: string | null; email?: string | null }, live: { sms: boolean; email: boolean }): OnTheWayChannel {
  const phone = normaliseUkPhone(to.phone ?? null);
  const textable = Boolean(phone && isTextable(phone));
  if (textable && (live.sms || !live.email)) return "sms";
  const email = to.email?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "email" : null;
}

/** "We'll text you when we're on the way." in the channel it'll really go by ("" when nothing would reach them). */
export function onTheWayLine(channel: OnTheWayChannel, who = "we're"): string {
  if (channel === "sms") return `We'll text you when ${who} on the way.`;
  if (channel === "email") return `We'll email you when ${who} on the way.`;
  return "";
}
