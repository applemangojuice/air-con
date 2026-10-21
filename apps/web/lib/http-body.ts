/**
 * Request bodies from public endpoints, read with a size cap. `request.text()`
 * and `request.json()` buffer whatever arrives (Vercel accepts up to 4.5 MB),
 * and what's parsed can end up stored: a declared length over the cap is
 * refused before anything is read, and a body that turns out bigger is cut
 * off as soon as it passes the cap.
 */

/** The body as text, or null when it's bigger than `maxBytes` (or unreadable). */
export async function readTextCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The body as JSON: `tooLarge` past the cap, `value` null when it isn't JSON. */
export async function readJsonCapped(request: Request, maxBytes: number): Promise<{ tooLarge: true } | { tooLarge: false; value: unknown }> {
  const text = await readTextCapped(request, maxBytes);
  if (text === null) return { tooLarge: true };
  try {
    return { tooLarge: false, value: JSON.parse(text) as unknown };
  } catch {
    return { tooLarge: false, value: null };
  }
}

/** Quote and draft bodies: a whole survey (12 rooms, their photos' paths) is a few kilobytes. */
export const QUOTE_BODY_MAX_BYTES = 256 * 1024;
