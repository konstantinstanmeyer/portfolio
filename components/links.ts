import type { GlyphId } from "./stipple/glyphs";

export interface IconLink {
  id: GlyphId;
  label: string;
  /** Shown in the name's place while the icon is hovered, as lines. */
  title: string[];
  /** Site paths ("/photography") navigate in-app; full URLs open in a new tab. */
  href: string;
}

/** The icon row under the name, left to right. */
export const ICON_LINKS: IconLink[] = [
  {
    id: "myrtle",
    label: "Myrtle Street Media",
    title: ["Myrtle Street", "Media"],
    href: "https://www.myrtlestreetmedia.com",
  },
  { id: "camera", label: "Photography", title: ["Photography"], href: "/photography" },
  { id: "notes", label: "Intabulate", title: ["Intabulate"], href: "https://intabulate.com" },
];
