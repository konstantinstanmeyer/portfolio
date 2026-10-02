import type { Metadata } from "next";
import { Axis } from "@/components/concepts/axis/Axis";
import { BOOT } from "@/components/concepts/axis/boot";
import { flex } from "@/components/concepts/axis/font";

export const metadata: Metadata = { title: "Konstantin Stanmeyer" };

export default function Page() {
  return (
    <main className={flex.className}>
      <Axis />
      <script dangerouslySetInnerHTML={{ __html: BOOT }} />
    </main>
  );
}
