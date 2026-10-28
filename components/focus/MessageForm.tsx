"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMessage } from "./actions";
import { LIMITS, type Field, type Sent } from "./message";
import s from "./focus.module.css";

const FIELDS: { name: Field; label: string; autoComplete: string; type?: string }[] = [
  { name: "name", label: "Name", autoComplete: "name" },
  { name: "email", label: "Email", autoComplete: "email", type: "email" },
  { name: "message", label: "Message", autoComplete: "off" },
];

/**
 * A message, by email. Works without JavaScript (the form posts to its server
 * action and the page comes back with the result); with it, the result
 * arrives in place. Bots are turned away by a field only they can see and
 * fill, and by how quickly they send; either way they are told it worked.
 */
export function MessageForm() {
  const [state, action, pending] = useActionState<Sent, FormData>(sendMessage, { status: "idle" });
  const form = useRef<HTMLFormElement>(null);
  const opened = useRef<HTMLInputElement>(null);

  // The stopwatch starts when the page can be used.
  useEffect(() => {
    if (opened.current) opened.current.value = String(Date.now());
  }, []);

  // Sent back with a problem: take the reader to the first one.
  useEffect(() => {
    if (state.status !== "invalid") return;
    const first = FIELDS.find(({ name }) => state.errors[name]);
    if (first) form.current?.querySelector<HTMLElement>(`[name="${first.name}"]`)?.focus();
  }, [state]);

  const errors = state.status === "invalid" ? state.errors : {};
  const values = "values" in state ? state.values : undefined;

  return (
    <form ref={form} action={action} className={s.form}>
      {FIELDS.map(({ name, label, autoComplete, type }) => {
        const id = `message-${name}`;
        const error = errors[name];
        const props = {
          id,
          name,
          autoComplete,
          required: true,
          maxLength: LIMITS[name],
          defaultValue: values?.[name],
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `${id}-error` : undefined,
        };
        return (
          <div className={s.field} key={name}>
            <label htmlFor={id}>{label}</label>
            {name === "message" ? <textarea rows={4} {...props} /> : <input type={type ?? "text"} {...props} />}
            {error && (
              <p className={s.error} id={`${id}-error`}>
                {error}
              </p>
            )}
          </div>
        );
      })}

      {/* For bots only: out of sight, out of the tab order, hidden from screen readers. */}
      <div className={s.trap} aria-hidden="true">
        <label htmlFor="message-website">Website</label>
        <input id="message-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input ref={opened} type="hidden" name="opened" />

      <div className={s.send}>
        <button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </button>
        <p role="status" className={s.status}>
          {state.status === "sent" && "Sent. Thank you, I’ll write back soon."}
          {state.status === "busy" && "That’s a few in a row. Try again in a little while."}
          {state.status === "failed" && `It didn’t go through. Write to ${state.write} instead.`}
        </p>
      </div>
    </form>
  );
}
