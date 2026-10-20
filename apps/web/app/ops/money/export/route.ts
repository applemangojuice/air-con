import { accountsRangeProblem } from "@aircon/domain";
import { audit } from "@/lib/audit";
import { ACCOUNTS_FILES, accountsFile, loadAccounts, type AccountsFile } from "@/lib/accounts-server";
import { requireStaffApi } from "@/lib/auth/server";
import { getServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /ops/money/export?file=invoices|payments|summary&from=yyyy-mm-dd&to=yyyy-mm-dd
 *
 * The accountant's CSVs (§K45): every invoice and credit note, every
 * payment and refund (card and bank transfer), and the totals that
 * reconcile them, for London dates from..to. Admins only (`finance.export`):
 * it holds every customer's money. Audited; never cached.
 */
export async function GET(request: Request): Promise<Response> {
  const staff = await requireStaffApi(request, "finance.export");
  if (staff instanceof Response) return staff;
  if (!getServiceClient()) return Response.json({ error: "No database connected" }, { status: 503 });
  const url = new URL(request.url);
  const file = url.searchParams.get("file") as AccountsFile | null;
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!file || !ACCOUNTS_FILES.includes(file)) return Response.json({ error: "Which file: invoices, payments or summary?" }, { status: 400 });
  const problem = accountsRangeProblem(from, to);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  try {
    const csv = accountsFile(await loadAccounts(from, to), file);
    await audit({ actor: staff, action: "accounts.export", entity: "accounts", detail: { file, from, to } });
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dih-${file}-${from}-to-${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[accounts] export failed:", err);
    return Response.json({ error: "The export couldn't be built. Try again." }, { status: 502 });
  }
}
