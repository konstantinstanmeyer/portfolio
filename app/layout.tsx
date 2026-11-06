import type { Metadata, Viewport } from "next";
import "./globals.css";

// Each page brings its own type: the home page Inter, the drafts their own.
export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
  description: "Building and designing at Myrtle Street Media. Developer and photographer in Boston.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased">
      <body className="bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
