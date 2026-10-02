"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createBridge } from "./bridge";
import { MessageBox } from "./message-box";
import { startSignal } from "./renderer";
import styles from "./signal.module.css";

export function SignalStage({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef(createBridge());

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    const name = root?.querySelector<HTMLElement>("h1");
    const form = root?.querySelector<HTMLFormElement>("form");
    const input = form?.querySelector<HTMLInputElement>("input[name=message]");
    const send = form?.querySelector<HTMLElement>("button[type=submit]");
    if (!root || !host || !name || !form || !input || !send) return;

    // Typing anywhere tunes into the message box.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    const stop = startSignal({ root, host, name, form, input, send }, bridgeRef.current);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, []);

  return (
    <main ref={rootRef} className={styles.root}>
      <div ref={hostRef} className={styles.field} aria-hidden="true" />
      <div className={styles.stack}>
        <div className={styles.block}>
          {children}
          <MessageBox bridgeRef={bridgeRef} />
        </div>
      </div>
    </main>
  );
}
