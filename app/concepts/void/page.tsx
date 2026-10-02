import type { Metadata } from "next";
import { VoidStage } from "@/components/concepts/void/void-stage";

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
};

export default function VoidPage() {
  return <VoidStage />;
}
