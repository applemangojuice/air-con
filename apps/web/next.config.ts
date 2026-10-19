import type { NextConfig } from "next";

/**
 * Security headers for every response. CSP is deliberately absent for now:
 * Next.js inline runtime scripts need nonces to coexist with a strict CSP,
 * which is a project of its own — the headers below cover the
 * high-value/no-risk set (clickjacking, MIME sniffing, referrer leakage,
 * powerful-API lockdown, HTTPS pinning).
 */
const securityHeaders = [
  // Nobody has a reason to iframe this site (and the ops console definitely
  // shouldn't be framable for clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Same-origin camera and location only: the field app takes photos in the
  // page (survey, install evidence, serials) and stamps an arrival fix. No
  // third-party frame gets either, and everything else stays off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()",
  },
  // Two years, subdomains included; Vercel serves HTTPS-only anyway.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@aircon/domain"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Browsers ask for /favicon.ico on their own; the icon is app/icon.svg.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
};

export default nextConfig;
