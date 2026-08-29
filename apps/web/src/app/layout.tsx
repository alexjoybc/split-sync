import type { Metadata } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["700"],
});

const siteUrl = "https://splitsync.org";
const title = "SplitSync — Live Race Classification for Velodrome & Cyclocross";
const description =
  "Run live, unofficial classification for grassroots mass-start racing. One-tap bib scoring that works offline, a public no-login live board for spectators, and real-time standings powered by Supabase. Built for velodrome and cyclocross.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s — SplitSync",
  },
  description,
  keywords: [
    "live race timing",
    "velodrome timing software",
    "cyclocross timing",
    "race classification software",
    "grassroots race timing",
    "lap counting app",
    "live results board",
    "bib scoring app",
  ],
  applicationName: "SplitSync",
  authors: [{ name: "SplitSync" }],
  category: "Sports",
  alternates: { canonical: siteUrl },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "SplitSync",
    title,
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
