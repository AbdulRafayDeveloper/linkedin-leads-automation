import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppShell from "@/components/layout/AppShell";
import {
  BRAND_COLOR,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  THEME_COLOR,
  getSiteUrl,
} from "@/lib/config/site";
import { LOGO_PNG_512, TILE_PNG_144 } from "@/lib/brand/assets";
import { BRAND_ICONS, baseOpenGraph, baseTwitter, siteRobots } from "@/lib/seo/metadata";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = getSiteUrl();

// Pages add their own title, description and canonical URL via pageMetadata().
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "Business",
  authors: [{ name: SITE_NAME, url: siteUrl }],
  icons: BRAND_ICONS,
  openGraph: { ...baseOpenGraph, title: SITE_TITLE, description: SITE_DESCRIPTION },
  twitter: { ...baseTwitter, title: SITE_TITLE, description: SITE_DESCRIPTION },
  // noindex unless ALLOW_SEARCH_INDEXING=true: there is no login and pages show lead data.
  robots: siteRobots(),
  // Leads are full of emails and phone numbers; don't let iOS turn them into links.
  formatDetection: { email: false, address: false, telephone: false },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  other: {
    "msapplication-TileColor": BRAND_COLOR,
    "msapplication-TileImage": TILE_PNG_144,
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  colorScheme: "light",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      // The brand, with the logo search engines show next to results.
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      url: siteUrl,
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}${LOGO_PNG_512}`,
        width: 512,
        height: 512,
        caption: `${SITE_NAME} logo`,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}/#app`,
      url: siteUrl,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      image: `${siteUrl}${LOGO_PNG_512}`,
      isPartOf: { "@id": `${siteUrl}/#website` },
      publisher: { "@id": `${siteUrl}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
