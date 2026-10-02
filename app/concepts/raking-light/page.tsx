import type { Metadata } from "next";
import { RakingLight } from "@/components/concepts/raking-light";

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
};

export default function Page() {
  return <RakingLight />;
}
