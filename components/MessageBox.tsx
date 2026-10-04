"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { sendMessage } from "@/app/actions";
import { initialMessageState, MAX_MESSAGE_LENGTH, type MessageState } from "@/lib/message";

const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(5px)" },
  { transform: "translateX(-3px)" },
  { transform: "translateX(0)" },
];

export default function MessageBox({ onSent }: { onSent?: (x: number, y: number) => void }) {
  const [value, setValue] = useState("");
  const [state, formAction, pending] = useActionState(
    async (prev: MessageState, formData: FormData): Promise<MessageState> => {
      const sent = String(formData.get("message") ?? "");
      try {
        const next = await sendMessage(prev, formData);
        // Only clear if nothing new was typed while sending.
        if (next.status === "sent") setValue((v) => (v === sent ? "" : v));
        return next;
      } catch {
        // Offline, a 5xx, or a stale deploy: show the error, keep the page.
        return { status: "error", at: Date.now() };
      }
    },
    initialMessageState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const onSentRef = useRef(onSent);

  useEffect(() => {
    onSentRef.current = onSent;
  });

  useEffect(() => {
    const form = formRef.current;
    if (!form || state.status === "idle") return;
    if (state.status === "sent") {
      const rect = form.getBoundingClientRect();
      onSentRef.current?.(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      form.animate(SHAKE, { duration: 380, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)" });
    }
  }, [state]);

  const empty = value.trim().length === 0;
  const showTick = state.status === "sent" && empty && !pending;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="fixed bottom-[max(2rem,env(safe-area-inset-bottom))] left-1/2 z-10 w-[min(18rem,calc(100vw-3rem))] -translate-x-1/2"
    >
      <div className="flex items-center gap-2 border-b border-ink/40 transition-colors focus-within:border-ink/70">
        <input
          type="text"
          name="message"
          aria-label="Send me a message"
          autoComplete="off"
          maxLength={MAX_MESSAGE_LENGTH}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[13px] text-ink caret-ink outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={pending || empty}
          className={`grid size-7 place-items-center rounded-full text-[15px] text-ink/70 transition-opacity outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/50 ${showTick ? "" : "disabled:opacity-25"}`}
        >
          {showTick ? (
            <span key={state.at} className="message-tick text-ink" aria-hidden="true">
              ✓
            </span>
          ) : (
            <span aria-hidden="true">→</span>
          )}
        </button>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <p className="sr-only" aria-live="polite">
        {state.status !== "idle" && (
          // Keyed so a repeat of the same outcome is announced again.
          <span key={state.at}>{state.status === "sent" ? "Message sent." : "Message could not be sent."}</span>
        )}
      </p>
    </form>
  );
}
