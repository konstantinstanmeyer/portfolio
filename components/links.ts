import type { GlyphId } from "./stipple/glyphs";
import type { TitleSpec } from "./stipple/StippleName";

export interface IconLink {
  id: GlyphId;
  label: string;
  /** What the name turns into while the icon is hovered. */
  hover: TitleSpec;
  /** Site paths ("/photography") navigate in-app; full URLs open in a new tab. */
  href: string;
}

/** The icon row under the name, left to right. */
export const ICON_LINKS: IconLink[] = [
  // The name stays put; a "?" appears after it.
  { id: "person", label: "About", hover: { after: "?" }, href: "/about" },
  {
    id: "myrtle",
    label: "Myrtle Street Media",
    hover: { lines: ["Myrtle Street", "Media"] },
    href: "https://www.myrtlestreetmedia.com",
  },
  { id: "camera", label: "Photography", hover: { lines: ["Photography"] }, href: "/photography" },
  { id: "notes", label: "Intabulate", hover: { lines: ["Intabulate"] }, href: "https://intabulate.com" },
];
