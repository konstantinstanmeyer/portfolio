import { Roboto_Flex } from "next/font/google";

export const flex = Roboto_Flex({
  subsets: ["latin"],
  axes: ["wdth", "opsz", "GRAD", "XTRA", "YOPQ", "YTUC"],
  display: "block",
  variable: "--font-axis",
});
