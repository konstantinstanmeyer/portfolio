"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser: skip prerendering and load three.js in
// its own chunk. The page underneath is already black, so nothing flashes.
const SpaceScene = dynamic(() => import("./scene"), { ssr: false });

export default function Space() {
  return <SpaceScene />;
}
