import type { Metadata } from "next";
import { Caprasimo, Figtree } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

// next/font generates its own family names, so each face declares a namespaced variable
// and globals.css points --font-heading / --font-sans at them.
const caprasimo = Caprasimo({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caprasimo",
  display: "swap",
});

const figtree = Figtree({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
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
