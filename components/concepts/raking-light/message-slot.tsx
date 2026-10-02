"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { sendMessage } from "@/app/actions";
import { initialMessageState, MAX_MESSAGE_LENGTH } from "@/lib/message";
import type { SlotBridge } from "./bridge";

const ANNOUNCE = { idle: "", sent: "Message sent.", error: "Message could not be sent." } as const;

export function MessageSlot({ bridge }: { bridge: SlotBridge }) {
  const [state, formAction, pending] = useActionState(sendMessage, initialMessageState);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.at === 0) return;
    const input = inputRef.current;
    if (state.status === "sent" && input) {
      input.value = "";
      bridge.emit("sent");
      bridge.setText("", 0, 0);
    } else if (state.status === "error") {
      bridge.emit("error");
    }
  }, [state, bridge]);

  const sync = () => {
    const el = inputRef.current;
    if (!el) return;
    bridge.setText(el.value, el.selectionStart ?? el.value.length, el.scrollLeft);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    if (!String(data.get("message") ?? "").trim()) {
      bridge.emit("empty");
      inputRef.current?.focus();
      return;
    }
    bridge.emit("submit");
    startTransition(() => formAction(data));
  };

  return (
    <form
      onSubmit={onSubmit}
      data-slot
      className="relative mt-[clamp(40px,9vh,104px)] flex h-11 w-[min(300px,78vw)] items-stretch rounded-[2px] shadow-[inset_0_-1px_0_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.06)] transition-shadow duration-700 group-data-[gl=on]:shadow-none"
    >
      <input
        ref={inputRef}
        name="message"
        type="text"
        aria-label="Message"
        maxLength={MAX_MESSAGE_LENGTH}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        readOnly={pending}
        onInput={sync}
        onSelect={sync}
        onKeyUp={sync}
        onScroll={sync}
        onFocus={() => bridge.setFocus(true)}
        onBlur={() => bridge.setFocus(false)}
        className="peer min-w-0 flex-1 cursor-text bg-transparent pr-1 pl-4 font-mono text-[15px] text-white/60 caret-white/60 outline-none selection:bg-white/15 group-data-[gl=on]:text-transparent group-data-[gl=on]:caret-transparent"
      />
      {/* Focus: the scored line glows faintly, like a filament. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-[38px] bottom-[6.5px] left-[10px] h-px bg-[linear-gradient(90deg,transparent,rgba(255,222,184,0.5)_20%,rgba(255,222,184,0.5)_80%,transparent)] opacity-0 shadow-[0_0_10px_1px_rgba(255,200,150,0.18)] transition-opacity duration-500 peer-focus-visible:opacity-100"
      />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <button
        type="submit"
        aria-label="Send message"
        data-mark
        className="group/send relative grid w-11 shrink-0 cursor-pointer place-items-center font-mono text-[15px] text-white/45 outline-none group-data-[gl=on]:text-transparent"
      >
        <span aria-hidden="true">↵</span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[9px] rounded-full opacity-0 shadow-[0_0_0_1px_rgba(255,222,184,0.4),0_0_10px_rgba(255,200,150,0.15)] transition-opacity duration-500 group-focus-visible/send:opacity-100"
        />
      </button>
      <p className="sr-only" aria-live="polite">
        <span key={state.at}>{ANNOUNCE[state.status]}</span>
      </p>
    </form>
  );
}
