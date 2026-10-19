import type { Metadata } from "next";
import AboutParagraph from "@/components/about/AboutParagraph";

export const metadata: Metadata = {
  title: "About — Konstantin Stanmeyer",
  description:
    "Konstantin Stanmeyer is a freelance developer who designs and builds applications and sites, runs Myrtle Street Media, and is building Intabulate.",
};

export default function About() {
  return <AboutParagraph />;
}
