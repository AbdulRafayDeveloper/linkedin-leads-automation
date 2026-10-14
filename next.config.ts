import type { NextConfig } from "next";

// Sent on every page and API response. The app shows lead data and has no
// login, so it must never be framed by another site and must not sit in a
// shared cache.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Logo files in public/ (see src/lib/brand/assets.ts). Their names carry no
// content hash, so they are cached for a day and revalidated in the background.
const BRAND_ASSET_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  // Lets a second build (QA, a parallel session) use its own output folder
  // instead of fighting over .next. Unset in normal use.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Hide the dev-only Next.js badge: it's framework branding and every corner
  // covers app UI (sidebar settings link, header button, footer). Compile and
  // runtime errors are still shown.
  devIndicators: false,

  async headers() {
    return [
      {
        // Everything except Next's immutable build output.
        source: "/((?!_next/static|_next/image).*)",
        headers: SECURITY_HEADERS,
      },
      {
        // Pages and API responses carry private lead data.
        source: "/((?!_next/static|_next/image|icons|.*\.(?:png|svg|ico|webmanifest|xml|txt)).*)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source:
          "/:file(favicon\\.ico|favicon\\.svg|favicon\\.png|favicon-\\d+x\\d+\\.png|apple-touch-icon\\.png|apple-touch-icon-\\d+x\\d+\\.png|safari-pinned-tab\\.svg)",
        headers: [{ key: "Cache-Control", value: BRAND_ASSET_CACHE }],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: BRAND_ASSET_CACHE }],
      },
    ];
  },

  // The dashboard is the app's home page; there is no page at "/".
  // Temporary (307), so browsers don't cache it forever if "/" ever gets a page again.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },

  // app/manifest.ts serves /manifest.webmanifest; these are the other names
  // browsers, audit tools and older guides look for.
  async rewrites() {
    return [
      { source: "/manifest.json", destination: "/manifest.webmanifest" },
      { source: "/site.webmanifest", destination: "/manifest.webmanifest" },
    ];
  },
};

export default nextConfig;
