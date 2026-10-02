"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useRef } from "react";
import { sendMessage } from "@/app/actions";
import { initialMessageState, MAX_MESSAGE_LENGTH } from "@/lib/message";
import { createVoid, type VoidHandle } from "./engine/engine";
import styles from "./void.module.css";

const NAME = "Konstantin Stanmeyer";
const LETTERS = Array.from(NAME);

export function VoidStage() {
  const [state, formAction, pending] = useActionState(sendMessage, initialMessageState);
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<VoidHandle | null>(null);
  const handledRef = useRef(0);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const input = inputRef.current;
    const button = buttonRef.current;
    const glow = glowRef.current;
    if (!stage || !canvas || !input || !button || !glow) return;
    const engine = createVoid({
      stage,
      canvas,
      input,
      button,
      name: Array.from(glow.children) as HTMLElement[],
    });
    engineRef.current = engine;
    if (!engine) {
      // No WebGL2: fall back to a plain luminous field.
      stage.dataset.fallback = "1";
      button.disabled = false;
      button.dataset.show = "1";
    }
    return () => {
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setPending(pending);
  }, [pending]);

  useEffect(() => {
    if (state.at === 0 || state.at === handledRef.current) return;
    handledRef.current = state.at;
    const engine = engineRef.current;
    const input = inputRef.current;
    if (state.status === "sent") {
      engine?.depart();
      if (input) input.value = "";
    } else if (state.status === "error") {
      engine?.reject();
    }
  }, [state]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = inputRef.current;
    if (!input || pending || !input.value.trim()) return;
    const data = new FormData(e.currentTarget);
    engineRef.current?.commit();
    startTransition(() => formAction(data));
  };

  return (
    <main ref={stageRef} className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <span className={styles.caret} aria-hidden="true" />

      <div className={styles.nameWrap}>
        <h1 className={styles.name}>{NAME}</h1>
        <span ref={glowRef} className={styles.glow} aria-hidden="true">
          {LETTERS.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </span>
      </div>

      <form onSubmit={onSubmit} autoComplete="off">
        <input
          ref={inputRef}
          className={styles.field}
          name="message"
          type="text"
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="Write a message to Konstantin, then press Enter to send"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          enterKeyHint="send"
        />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <button ref={buttonRef} type="submit" className={styles.send} aria-label="Send message" disabled data-show="0">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.5 2.5v5.25a2 2 0 0 1-2 2H3m0 0 3.25-3.25M3 9.75 6.25 13"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>

      <p className="sr-only" role="status" aria-live="polite">
        {state.status === "sent" ? "Message sent." : state.status === "error" ? "The message could not be sent. Please try again." : ""}
      </p>
    </main>
  );
}
