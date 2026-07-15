import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { HouseArchetype, InstallPermutation } from "@aircon/domain";

/**
 * Turns a walkthrough narration transcript into a structured floor plan draft.
 * Uses Claude with structured outputs so the result always validates.
 */

const extractedRoomSchema = z.object({
  name: z.string().describe("Room name as the customer called it, e.g. 'main bedroom'"),
  type: z.enum([
    "bedroom",
    "living-room",
    "kitchen-diner",
    "home-office",
    "loft-room",
    "conservatory",
    "other",
  ]),
  size: z
    .enum(["small", "medium", "large", "xl"])
    .describe("small ≈ box room <10m², medium ≈ double bedroom, large ≈ main living room, xl ≈ open plan 24m²+"),
  floor: z.enum(["ground", "first", "second-plus", "loft"]),
  glazing: z
    .enum(["low", "medium", "high"])
    .describe("How much window glass was described or implied; medium if unknown"),
  orientation: z.enum(["north", "east", "south", "west", "unsure"]),
  hasExternalWall: z.boolean().describe("true unless the narration implies an internal room"),
  wantsCooling: z
    .boolean()
    .describe("true only if the customer wants a unit in this room"),
  notes: z.string().describe("Anything the customer said about this room worth keeping; empty string if nothing"),
});

const extractionSchema = z.object({
  rooms: z.array(extractedRoomSchema).describe("Every room mentioned in the walkthrough"),
  outdoorNotes: z
    .string()
    .describe("What was said about outdoor space, unit position or access; empty string if nothing"),
  electricsCondition: z.enum(["modern-spare-ways", "modern-full", "older-fuse-box", "unsure"]),
  customerWishes: z
    .string()
    .describe("One-paragraph summary of what the customer wants overall"),
  uncertainties: z
    .array(z.string())
    .describe("Things the narration left unclear that ops should verify against the video"),
});

export type Extraction = z.infer<typeof extractionSchema>;

export function isExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function extractFromTranscript(
  transcript: string,
  archetype: HouseArchetype,
  permutation: InstallPermutation,
): Promise<Extraction | null> {
  if (!isExtractionConfigured()) return null;

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system: `You extract structured home-survey data from a customer's narrated video walkthrough of their house.

Context about this home:
- House archetype: ${archetype.name} (${archetype.eraLabel}) — ${archetype.description}
- Chosen install pattern: ${permutation.label} — ${permutation.summary} It serves up to ${permutation.servesUpTo} rooms.

Rules:
- Create one entry per distinct room the customer mentions, even rooms they don't want cooled (wantsCooling=false for those).
- Infer size bands conservatively from context ("big open plan kitchen" → xl; a child's bedroom → small; unknown bedroom → medium).
- Room type ${archetype.id === "sixties-bungalow" ? "floors are all 'ground' in a bungalow unless a loft room is mentioned" : "floors: bedrooms default to 'first' in a two-storey house unless stated otherwise"}.
- Do not invent rooms, sizes, or wishes that aren't supported by the transcript; put doubts in 'uncertainties'.`,
    messages: [
      {
        role: "user",
        content: `Transcript of the walkthrough:\n\n${transcript}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(extractionSchema),
    },
  });

  return response.parsed_output ?? null;
}
