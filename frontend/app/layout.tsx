import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

// The fonts live in the repo (Google Fonts' files, Latin and Latin Extended, under the OFL next
// to them), so a build never downloads anything and cannot fail on a network hiccup.
// next/font generates its own family names, so each face declares a namespaced variable
// and globals.css points --font-heading / --font-sans at them.
const caprasimo = localFont({
  src: "./fonts/Caprasimo.woff2",
  weight: "400",
  variable: "--font-caprasimo",
  display: "swap",
});

// A variable font: one file serves every weight the pages use (400, 600, 700).
const figtree = localFont({
  src: "./fonts/Figtree.woff2",
  weight: "300 900",
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PlotlineAI",
  description:
    "Upload a CSV and get the chart you meant to make. Column types read, charts suggested, numbers aggregated over your whole file.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Every page is rendered per request, because each response carries a fresh CSP nonce
  // (proxy.ts) that Next stamps on its scripts. A page prerendered at build time would ship
  // scripts without it, and the browser would refuse to run them.
  await connection();

  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
