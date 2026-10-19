"use client";

import { useRef, useState } from "react";
import IconRow from "./IconRow";
import { ICON_LINKS } from "./links";
import Portrait from "./Portrait";
import { portraitDots } from "./portrait-dots";
import type { Area } from "./stipple/raster";
import StippleName, { type StippleHandle } from "./stipple/StippleName";
import type { Rect } from "./stipple/stipple";

const ICONS = ICON_LINKS.map((link) => link.id);
const TITLES = ICON_LINKS.map((link) => link.hover);

export default function Landing() {
  const stipple = useRef<StippleHandle>(null);
  const [iconRects, setIconRects] = useState<Rect[]>([]);
  const [portrait, setPortrait] = useState<Area | null>(null);
  return (
    <>
      <StippleName
        ref={stipple}
        icons={ICONS}
        titles={TITLES}
        onIconLayout={setIconRects}
        split
        onLayout={(layout) => setPortrait(layout.portrait)}
        extraDots={(layout, kind) => portraitDots(layout.portrait, kind)}
      />
      {portrait && <Portrait area={portrait} />}
      <IconRow rects={iconRects} onHover={(index) => stipple.current?.hoverIcon(index)} />
    </>
  );
}
