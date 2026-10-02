"use client";

import { useEffect, useRef, useState } from "react";
import { SlotBridge } from "./bridge";
import { mountEngine } from "./engine";
import { MessageSlot } from "./message-slot";

export function Stage({ fontClass }: { fontClass: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bridge] = useState(() => new SlotBridge());

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    return mountEngine(root, canvas, bridge);
  }, [bridge]);

  return (
    <main
      ref={rootRef}
      className={`${fontClass} group fixed inset-x-0 top-0 h-dvh touch-none overflow-hidden bg-[#0b0b0c] select-none data-[gl=on]:cursor-none`}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-[1200ms] ease-out group-data-[gl=on]:opacity-100"
      />
      <div className="relative flex h-full flex-col items-center justify-center px-4 pb-[4vh]">
        <h1
          data-name
          className="text-center font-[family-name:var(--font-rl-display)] text-[clamp(52px,14.5vw,84px)] leading-[0.98] font-medium tracking-[-0.025em] text-[#0c0c0d] [font-stretch:112.5%] [text-shadow:0_-1px_0_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.075)] transition-[color,text-shadow] duration-[1200ms] group-data-[gl=on]:text-transparent group-data-[gl=on]:[text-shadow:none] sm:text-[clamp(40px,6.4vw,184px)]"
        >
          <span data-word className="max-sm:block">
            Konstantin
          </span>{" "}
          <span data-word className="max-sm:block">
            Stanmeyer
          </span>
        </h1>
        <MessageSlot bridge={bridge} />
      </div>
    </main>
  );
}
