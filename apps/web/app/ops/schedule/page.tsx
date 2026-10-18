import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/server";

/** The old schedule board lives on as the calendar (v2 projects, crew, deliveries). Old links still land. */
export default async function SchedulePage() {
  await requireStaff("projects.view-all");
  redirect("/ops/calendar");
}
