import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  quoteId: z.string().uuid(),
  preferredStart: z.enum(["asap", "2-4-weeks", "1-2-months", "flexible"]),
  notes: z.string().max(2000).optional().default(""),
});

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "bookings", 10, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid booking" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    console.info("[demo mode] booking request:", parsed.data.quoteId);
    return NextResponse.json({ ok: true, demo: true });
  }

  const { quoteId, preferredStart, notes } = parsed.data;
  const { error } = await supabase
    .from("quote_requests")
    .update({
      booking: { preferredStart, notes },
      booked_at: new Date().toISOString(),
      status: "booked",
    })
    .eq("id", quoteId);

  if (error) {
    console.error("booking update failed:", error.message);
    return NextResponse.json({ error: "Could not save booking" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, demo: false });
}
