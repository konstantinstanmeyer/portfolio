"use client";

import { useActionState, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { sendMessage } from "@/app/actions";
import { initialMessageState, MAX_MESSAGE_LENGTH } from "@/lib/message";
import type { InkFluid } from "./engine/fluid";
import { inputMetrics, rasterizeInput } from "./engine/raster";
import styles from "./ink.module.css";

export function MessageLine({ fluid }: { fluid: RefObject<InkFluid | null> }) {
  const [state, formAction, pending] = useActionState(sendMessage, initialMessageState);
  const [text, setText] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [seenAt, setSeenAt] = useState(state.at);
  const inputRef = useRef<HTMLInputElement>(null);
  const probeRef = useRef<HTMLCanvasElement | null>(null);

  if (state.at !== seenAt) {
    setSeenAt(state.at);
    setReleasing(false);
    if (state.status === "sent") setText("");
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const next = el.value;
    const grew = next.length > text.length;
    setText(next);
    const f = fluid.current;
    if (!grew || !f) return;
    probeRef.current ??= document.createElement("canvas");
    const ctx = probeRef.current.getContext("2d");
    if (!ctx) return;
    const m = inputMetrics(el, ctx);
    const caret = el.selectionEnd ?? next.length;
    const x = m.left + ctx.measureText(next.slice(0, caret)).width;
    f.leak(Math.min(Math.max(x, m.box.left), m.box.right - 2), m.box.bottom - 0.5);
  };

  const submit = (data: FormData) => {
    if (!String(data.get("message") ?? "").trim()) return;
    const input = inputRef.current;
    const f = fluid.current;
    if (input && f) {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const r = rasterizeInput(input, input.value, scale, document.createElement("canvas"));
      if (r) f.release(r.canvas, r.rect);
    }
    // on phones, drop the keyboard so the words can be watched leaving
    if (input && window.matchMedia("(pointer: coarse)").matches) input.blur();
    setReleasing(true);
    formAction(data);
  };

  const status = state.at === 0 ? "idle" : state.status;

  return (
    <form
      action={submit}
      className={styles.form}
      data-empty={text.length === 0}
      data-releasing={releasing || pending}
      data-status={status}
    >
      <span className={styles.rule} aria-hidden="true" key={`rule-${state.at}`} />
      <span className={styles.hint} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.field}
        type="text"
        name="message"
        value={text}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        maxLength={MAX_MESSAGE_LENGTH}
        aria-label="Message"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
      />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <button type="submit" className={styles.send} aria-label="Send message" disabled={pending}>
        <svg key={`arrow-${state.at}`} className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 12.4c5.2-.3 10.6-.5 16.4-.2M14.6 6.8c1.9 2.1 3.6 3.9 5.4 5.4-1.8 1.4-3.6 3.2-5.3 5.2" />
        </svg>
        {status === "sent" && (
          <svg key={state.at} className={styles.tick} viewBox="0 0 24 24" aria-hidden="true">
            <path pathLength={1} d="M4.2 12.8c1.9 1.5 3.5 3.1 5 5.2 3-5.2 6.6-9.4 10.6-12.6" />
          </svg>
        )}
        {status === "error" && (
          <svg key={state.at} className={styles.cross} viewBox="0 0 24 24" aria-hidden="true">
            <path pathLength={1} d="M6.5 6.8c3.6 3.3 7.4 7 11 10.6M17.3 6.5c-3.4 3.7-7.2 7.3-10.8 11" />
          </svg>
        )}
      </button>
      <p className="sr-only" aria-live="polite">
        <span key={state.at}>
          {status === "sent" ? "Message sent." : status === "error" ? "Message could not be sent." : ""}
        </span>
      </p>
    </form>
  );
}
