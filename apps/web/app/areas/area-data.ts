/**
 * Local pages for the areas we know well enough to write about honestly:
 * the housing stock and the install patterns it usually means. Nothing here
 * claims a track record; whether we install there today comes from the
 * service area in settings, never from this list.
 */

export interface AreaPage {
  outcode: string;
  name: string;
  intro: string;
  housing: string[];
  examples: { label: string; type: "semi-detached" | "terraced"; era: "pre-1930" | "1930-1950"; bedrooms: number }[];
}

export const AREA_PAGES: Record<string, AreaPage> = {
  sw16: {
    outcode: "SW16",
    name: "Streatham",
    intro:
      "Streatham's housing is remarkably consistent: long Victorian terraces and inter-war semis. That consistency is why an online price works here. Homes like yours tend to follow a handful of install patterns, and your survey confirms which one is yours.",
    housing: [
      "Victorian terraces with rear additions: the outdoor unit usually sits at the back at ground level, with pipework running beside the soil stack.",
      "1930s semis around Streatham Common and Norbury: a side passage often means a short, tidy pipe route.",
      "Loft conversions are everywhere, and a converted loft is usually the hottest room in the house in summer.",
    ],
    examples: [
      { label: "Victorian terrace, 3 bed", type: "terraced", era: "pre-1930", bedrooms: 3 },
      { label: "1930s semi, 3 bed", type: "semi-detached", era: "1930-1950", bedrooms: 3 },
    ],
  },
  sw17: {
    outcode: "SW17",
    name: "Tooting",
    intro:
      "Tooting is tight Victorian grids around the Broadway and Bec, with inter-war streets towards Furzedown. The same terraces repeat street after street, so the likely install for your home is usually clear before anyone visits.",
    housing: [
      "Victorian mid-terraces off Tooting High Street: typically a rear ground-level outdoor unit, with pipework boxed in at first floor.",
      "End-of-terrace corners give more choice for the outdoor unit and often the simplest pipe routes.",
      "Loft rooms and rear extensions are common, and they're usually the rooms people most want cooled in summer and warmed in winter.",
    ],
    examples: [
      { label: "Victorian terrace, 3 bed", type: "terraced", era: "pre-1930", bedrooms: 3 },
      { label: "Larger terrace, 4 bed", type: "terraced", era: "pre-1930", bedrooms: 4 },
    ],
  },
};
