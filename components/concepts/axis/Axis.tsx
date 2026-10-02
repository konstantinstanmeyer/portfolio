"use client";

import { useEffect, useRef } from "react";
import { createEngine, type Engine } from "./engine";
import { Message } from "./Message";
import styles from "./axis.module.css";

const LETTERS = Array.from("KONSTANTINSTANMEYER");

export function Axis() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const e = createEngine({
      root,
      letters: Array.from(root.querySelectorAll<HTMLElement>("[data-l]")),
      reduced: mq.matches,
    });
    engine.current = e;
    const onMotion = () => e.setReduced(mq.matches);
    mq.addEventListener("change", onMotion);
    return () => {
      mq.removeEventListener("change", onMotion);
      e.destroy();
      engine.current = null;
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.root} data-axis-root="" suppressHydrationWarning>
      <h1 className={styles.sr}>Konstantin Stanmeyer</h1>
      <div className={styles.stage} aria-hidden="true">
        {LETTERS.map((c, i) => (
          <span key={i} data-l="" className={styles.l} suppressHydrationWarning>
            {c}
          </span>
        ))}
      </div>
      <Message engine={engine} />
    </div>
  );
}
