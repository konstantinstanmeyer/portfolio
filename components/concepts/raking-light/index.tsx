import { Mona_Sans } from "next/font/google";
import { Stage } from "./stage";

const display = Mona_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-rl-display",
});

export function RakingLight() {
  return <Stage fontClass={display.variable} />;
}
