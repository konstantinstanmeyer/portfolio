import type { Metadata } from "next";
import { Geist } from "next/font/google";

// Geist, for the bare draft (Tailwind's font-sans); the others set their own.
const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Design drafts: each page brings its own type, colour and layout.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DraftsLayout({ children }: LayoutProps<"/">) {
  return <div className={`${geist.variable} font-sans`}>{children}</div>;
}
