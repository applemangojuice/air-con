/** How close a certificate is to expiring: expired (red), within 60 days (amber), current, or no date. */
export type ExpiryState = "expired" | "soon" | "current" | "no-expiry";

export const EXPIRY_WARNING_DAYS = 60;

export function expiryState(expiresOn: string | undefined, today: string): ExpiryState {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}/.test(expiresOn)) return "no-expiry";
  const exp = expiresOn.slice(0, 10);
  const day = today.slice(0, 10);
  if (exp < day) return "expired";
  const days = Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return days <= EXPIRY_WARNING_DAYS ? "soon" : "current";
}
