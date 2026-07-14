import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { getServiceClient } from "@/lib/supabase-server";

const photoSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "room",
    "window",
    "external-wall",
    "outdoor-location",
    "fuse-board",
    "side-access",
  ]),
  storagePath: z.string().optional(),
  fileName: z.string().optional(),
});

const surveySchema = z.object({
  postcode: z.string().min(5).max(10),
  addressLine: z.string().min(3).max(200),
  property: z.object({
    type: z.enum(["detached", "semi-detached", "terraced", "flat", "bungalow"]),
    era: z.enum(["pre-1930", "1930-1979", "1980-1999", "2000+"]),
    bedrooms: z.number().int().min(1).max(12),
    ownership: z.enum(["owner", "renting"]),
  }),
  rooms: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(60),
        type: z.enum([
          "bedroom",
          "living-room",
          "kitchen-diner",
          "home-office",
          "loft-room",
          "conservatory",
          "other",
        ]),
        size: z.enum(["small", "medium", "large", "xl"]),
        floor: z.enum(["ground", "first", "second-plus", "loft"]),
        glazing: z.enum(["low", "medium", "high"]),
        orientation: z.enum(["north", "east", "south", "west", "unsure"]),
        hasExternalWall: z.boolean(),
        photos: z.array(photoSchema),
      }),
    )
    .min(1)
    .max(12),
  outdoor: z.object({
    location: z.enum([
      "ground-rear",
      "ground-side",
      "wall-bracket",
      "flat-roof",
      "balcony",
      "unsure",
    ]),
    photos: z.array(photoSchema),
  }),
  electrics: z.object({
    condition: z.enum(["modern-spare-ways", "modern-full", "older-fuse-box", "unsure"]),
    photos: z.array(photoSchema),
  }),
});

const bodySchema = z.object({
  survey: surveySchema,
  contact: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(200),
    phone: z.string().max(30).optional().default(""),
    timeframe: z.enum(["asap", "1-3-months", "researching"]),
  }),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid survey" }, { status: 400 });
  }

  const { survey, contact } = parsed.data;
  // The server recomputes the quote — the stored price never comes from the client.
  const quote = generateQuote(survey as Survey);

  const supabase = getServiceClient();
  if (!supabase) {
    console.info("[demo mode] quote request:", contact.email, quote.totalGbp);
    return NextResponse.json({ ok: true, demo: true });
  }

  const { data, error } = await supabase
    .from("quote_requests")
    .insert({
      customer_name: contact.name,
      email: contact.email,
      phone: contact.phone || null,
      timeframe: contact.timeframe,
      postcode: survey.postcode,
      address_line: survey.addressLine,
      engine_version: quote.engineVersion,
      survey,
      quote,
      total_gbp: quote.totalGbp,
      room_count: survey.rooms.length,
      confidence_score: quote.confidence.score,
      confidence_band: quote.confidence.band,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("quote insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save quote" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, demo: false, id: data.id });
}
