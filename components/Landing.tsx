"use client";

import { useRef, useState } from "react";
import IconRow from "./IconRow";
import { ICON_LINKS } from "./links";
import MessageBox from "./MessageBox";
import StippleName, { type StippleHandle } from "./stipple/StippleName";
import type { Rect } from "./stipple/stipple";

const ICONS = ICON_LINKS.map((link) => link.id);
const TITLES = ICON_LINKS.map((link) => link.title);

export default function Landing() {
  const stipple = useRef<StippleHandle>(null);
  const [iconRects, setIconRects] = useState<Rect[]>([]);
  return (
    <>
      <StippleName ref={stipple} icons={ICONS} titles={TITLES} onIconLayout={setIconRects} />
      <IconRow rects={iconRects} onHover={(index) => stipple.current?.hoverIcon(index)} />
      <MessageBox onSent={(x, y) => stipple.current?.pulse(x, y)} />
    </>
  );
}
