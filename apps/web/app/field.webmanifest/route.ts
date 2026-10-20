import { BRAND } from "@/lib/brand";

/**
 * The field app's own Home Screen identity (§K45): added from `/field`, the
 * icon opens `/field`, not the public home page (`app/manifest.ts`). The
 * Home Screen app keeps its own sign-in, apart from the browser's: the crew
 * signs in there once with the 6-digit code from the sign-in email (a link
 * tapped in an email always opens the browser instead).
 *
 * Outside /field on purpose: the middleware's staff wall would send the
 * phone's manifest fetch to /login.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      id: "/field",
      name: `${BRAND.name} Field`,
      short_name: "Field",
      description: "The crew's jobs, surveys, photos and sign-offs.",
      start_url: "/field",
      scope: "/",
      display: "standalone",
      background_color: "#f8f5ef",
      theme_color: "#ffffff",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
