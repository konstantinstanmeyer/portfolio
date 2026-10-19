import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { CSSProperties } from "react";
import HyperspaceProvider from "@/components/hyperspace/HyperspaceProvider";
import PerformanceNotice from "@/components/PerformanceNotice";
import { PALETTE } from "@/components/stipple/palette";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
  description: "Konstantin Stanmeyer",
};

// Light dots only ever sit on a dark ground.
const colorScheme = PALETTE.glow ? "dark" : "light";

export const viewport: Viewport = {
  themeColor: PALETTE.paper,
  colorScheme,
};

// Inline so the very first paint already has the palette's background, before
// any stylesheet arrives. --paper / --ink back the Tailwind `paper` / `ink` tokens.
const htmlStyle = {
  backgroundColor: PALETTE.paper,
  colorScheme,
  "--paper": PALETTE.paper,
  "--ink": PALETTE.ink,
} as CSSProperties;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      style={htmlStyle}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-paper text-ink">
        {/* Page changes go by hyperspace; the overlay outlives the pages it moves between. */}
        <HyperspaceProvider>{children}</HyperspaceProvider>
        {/* Says so when reduced motion, missing graphics or a capped frame rate hold the dots back. */}
        <PerformanceNotice />
      </body>
    </html>
  );
}
