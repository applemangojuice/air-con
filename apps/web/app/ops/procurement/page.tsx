import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/server";

/** The old regex-guessed procurement plan is replaced by real purchase orders from the design. Old links still land. */
export default async function ProcurementPage() {
  await requireStaff("projects.view-all");
  redirect("/ops/purchasing");
}
