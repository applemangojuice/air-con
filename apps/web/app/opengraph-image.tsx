import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

/**
 * The social share card: what the site looks like when a link lands in
 * WhatsApp, iMessage, Slack or LinkedIn. Rendered from brand tokens with
 * the real display faces (TTF copies in lib/og — satori can't read woff2),
 * so shares look designed rather than like a screenshot.
 */

export const alt = `${BRAND.name} — fixed-price home air conditioning`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const [caprasimo, figtree] = await Promise.all([
    readFile(join(process.cwd(), "lib/og/caprasimo.ttf")),
    readFile(join(process.cwd(), "lib/og/figtree-600.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f8f5ef",
          padding: 72,
          fontFamily: "Figtree",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, color: "#1d212b" }}>
          <span style={{ fontFamily: "Caprasimo" }}>{BRAND.nameLead}&nbsp;</span>
          <span style={{ fontFamily: "Caprasimo", color: "#f2711b" }}>{BRAND.nameHot}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontFamily: "Caprasimo",
              fontSize: 84,
              lineHeight: 1.05,
              color: "#1d212b",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Air conditioning,</span>
            <span style={{ display: "flex" }}>
              fixed price in&nbsp;<span style={{ color: "#d55a0a" }}>2 minutes</span>
            </span>
          </div>
          <div style={{ fontSize: 32, color: "#6e7482", display: "flex" }}>
            No salesperson, no surveyor, no sharp intake of breath.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#d55a0a",
              color: "#ffffff",
              borderRadius: 999,
              padding: "18px 36px",
            }}
          >
            Get my fixed price
          </div>
          <div style={{ color: "#a3a8b4", display: "flex" }}>
            {BRAND.strap}, street by street
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Caprasimo", data: caprasimo, weight: 400, style: "normal" },
        { name: "Figtree", data: figtree, weight: 600, style: "normal" },
      ],
    },
  );
}
