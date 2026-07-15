import { z } from "zod";

/** Shared wire-schema for surveys — used by the quote and draft endpoints. */

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

export const surveySchema = z.object({
  postcode: z.string().min(5).max(10),
  addressLine: z.string().min(3).max(200),
  archetypeId: z.string().max(60).optional(),
  permutationId: z.string().max(60).optional(),
  geo: z
    .object({
      district: z.string().max(100).optional(),
      region: z.string().max(100).optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })
    .optional(),
  property: z.object({
    type: z.enum(["detached", "semi-detached", "terraced", "flat", "bungalow"]),
    era: z.enum(["pre-1930", "1930-1950", "1950-2000", "2000+"]),
    bedrooms: z.number().int().min(1).max(12),
    bathrooms: z.number().int().min(0).max(8).optional(),
    floorAreaM2: z.number().min(10).max(2000).optional(),
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
        areaM2: z.number().min(1).max(500).optional(),
        floor: z.enum(["ground", "first", "second-plus", "loft"]),
        glazing: z.enum(["low", "medium", "high"]),
        orientation: z.enum(["north", "east", "south", "west", "unsure"]),
        hasExternalWall: z.boolean(),
        photos: z.array(photoSchema),
      }),
    )
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

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
