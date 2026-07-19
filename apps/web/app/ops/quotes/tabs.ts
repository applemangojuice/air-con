/**
 * The tab → status taxonomy for quote requests, shared by the list page, the
 * CSV export and the ops-home pulse tiles. One definition: the on-screen
 * table, the downloaded CSV and the dashboard counts can never disagree.
 */
export const QUOTE_TABS: { key: string; label: string; statuses?: string[] }[] = [
  { key: "inbox", label: "Inbox", statuses: ["new", "reviewed"] },
  { key: "drafts", label: "Unfinished (follow up)", statuses: ["draft"] },
  { key: "booked", label: "Booked", statuses: ["booked"] },
  { key: "all", label: "Everything" },
];

export function tabByKey(key: string | undefined) {
  return QUOTE_TABS.find((t) => t.key === key);
}
