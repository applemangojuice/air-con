/**
 * The name typed into the public quote funnel. It's printed in the quote
 * email we send to whatever address was typed ("Hi <name>,"), from our own
 * domain, so it may only be a name: letters (any alphabet), spaces and the
 * punctuation names use. No digits (no "call 0800 …"), nothing shaped like a
 * web address or an email, no markup. Pure: the funnel shows the same rule
 * as the server applies.
 */

export const PERSON_NAME_MAX = 80;

const NAME_CHARS = /^[\p{L}\p{M}][\p{L}\p{M} .,'’&()-]*$/u;
/** "evil.com", "bit.ly", "paypal.co.uk": letters, a dot, letters, no space between. */
const WEB_LIKE = /[\p{L}\p{N}]{2,}\.[\p{L}]{2,}/u;

/** Why this can't be the name on a quote, in words for the form; null when it's fine. */
export function personNameProblem(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim();
  if (name.length < 2) return "Add your name (at least two letters).";
  if (name.length > PERSON_NAME_MAX) return `That's a long name: ${PERSON_NAME_MAX} characters at most.`;
  if (!NAME_CHARS.test(name)) return "Just your name, please: letters, spaces, hyphens and apostrophes.";
  if (WEB_LIKE.test(name)) return "That looks like a web address. Just your name, please.";
  return null;
}
