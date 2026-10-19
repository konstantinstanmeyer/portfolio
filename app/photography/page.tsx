import type { Metadata } from "next";
import PhotoField from "@/components/photography/PhotoField";

export const metadata: Metadata = {
  title: "Photography — Konstantin Stanmeyer",
  description: "Photographs by Konstantin Stanmeyer. Sharing more soon.",
};

export default function PhotographyPage() {
  return <PhotoField />;
}
