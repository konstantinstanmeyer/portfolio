"use client";

import {
  useActionState,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { sendMessage } from "@/app/actions";
import { initialMessageState, MAX_MESSAGE_LENGTH } from "@/lib/message";
import type { SignalBridge } from "./bridge";
import styles from "./signal.module.css";

export function MessageBox({ bridgeRef }: { bridgeRef: RefObject<SignalBridge> }) {
  const [state, formAction, pending] = useActionState(sendMessage, initialMessageState);
  const [value, setValue] = useState("");
  const [seenAt, setSeenAt] = useState(state.at);

  if (state.at !== seenAt) {
    setSeenAt(state.at);
    if (state.status === "sent") setValue("");
  }

  useEffect(() => {
    if (state.status === "idle") return;
    bridgeRef.current.feedback = state.status;
    bridgeRef.current.feedbackAt = performance.now();
  }, [state, bridgeRef]);

  useEffect(() => {
    bridgeRef.current.boxVersion += 1;
  }, [value, bridgeRef]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const added = next.length - value.length;
    if (added > 0) {
      const end = e.target.selectionStart ?? next.length;
      bridgeRef.current.insertStart = end - added;
      bridgeRef.current.insertEnd = end;
      bridgeRef.current.insertAt = performance.now();
    }
    setValue(next);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (pending || !value.trim()) {
      e.preventDefault();
      bridgeRef.current.rejectAt = performance.now();
      return;
    }
    bridgeRef.current.transmitAt = performance.now();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") e.currentTarget.blur();
  };

  const announcement =
    state.status === "sent"
      ? "Message sent."
      : state.status === "error"
        ? "Message could not be sent. Please try again."
        : "";

  return (
    <form action={formAction} onSubmit={onSubmit} className={styles.box}>
      <input
        name="message"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        maxLength={MAX_MESSAGE_LENGTH}
        aria-label="Message"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        className={styles.input}
      />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <button type="submit" aria-label="Send message" className={styles.send}>
        →
      </button>
      <p aria-live="polite" className="sr-only">
        {announcement && <span key={state.at}>{announcement}</span>}
      </p>
    </form>
  );
}
