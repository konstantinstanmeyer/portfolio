import type { Metadata, Viewport } from "next";
import { InkLanding } from "@/components/concepts/ink/ink-landing";
import { inkSerif } from "@/components/concepts/ink/font";

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
};

export const viewport: Viewport = {
  themeColor: "#f1ede5",
  colorScheme: "light",
  interactiveWidget: "resizes-visual",
};

export default function InkPage() {
  return (
    <div className={inkSerif.variable}>
      <InkLanding />
    </div>
  );
}
