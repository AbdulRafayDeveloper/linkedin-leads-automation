import type { NextConfig } from "next";

// Logo files in public/ (see src/lib/brand/assets.ts). Their names carry no
// content hash, so they are cached for a day and revalidated in the background.
const BRAND_ASSET_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  // Hide the dev-only Next.js badge: it's framework branding and every corner
  // covers app UI (sidebar settings link, header button, footer). Compile and
  // runtime errors are still shown.
  devIndicators: false,

  async headers() {
    return [
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
