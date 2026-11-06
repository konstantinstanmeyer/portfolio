"use client";

import { Component, useActionState, useEffect, useRef } from "react";
import { sendMessage } from "./actions";
import { LIMITS, type Field, type Sent, type Values } from "./message";
import s from "./focus.module.css";

// Each with a hint, in its field, of what goes there.
const FIELDS: { name: Field; label: string; hint: string; autoComplete: string; type?: string }[] = [
  { name: "name", label: "Name", hint: "Your name", autoComplete: "name" },
  { name: "email", label: "Email", hint: "you@example.com", autoComplete: "email", type: "email" },
  { name: "message", label: "Message", hint: "A few lines are plenty.", autoComplete: "off" },
];

// What was written, kept for this tab until it is sent, so neither a failed
// send nor a reload loses it.
const DRAFT = "contact-draft";

let attempts = 0;

/**
 * A message, by email. Works without JavaScript (the form posts to its server
 * action and the page comes back at the form, with the result); with it, the
 * result arrives in place. Bots are turned away by a field only they can see
 * and fill, and by how quickly they send; either way they are told it worked.
 *
 * If sending throws (the connection drops, or the site was updated since the
 * page loaded), the form starts over with what was written and says so,
 * rather than taking the page down with it.
 */
export class MessageForm extends Component<object, { attempt: number }> {
  state = { attempt: 0 };

  static getDerivedStateFromError() {
    return { attempt: ++attempts };
  }

  render() {
    const { attempt } = this.state;
    return <Letter key={attempt} failed={attempt > 0} />;
  }
}

function Letter({ failed }: { failed: boolean }) {
  // The permalink brings a send without JavaScript back to the form.
  const [state, action, pending] = useActionState<Sent, FormData>(sendMessage, { status: "idle" }, "/#contact");
  const form = useRef<HTMLFormElement>(null);
  const elapsed = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLParagraphElement>(null);

  // What was written before a failure or a reload, back in its fields.
  useEffect(() => {
    const fields = form.current?.elements;
    if (!fields) return;
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT) ?? "null") as Partial<Values> | null;
      for (const { name } of FIELDS) {
        const field = fields.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
        if (field && !field.value && typeof draft?.[name] === "string") field.value = draft[name];
      }
    } catch {}
  }, []);

  // Started over after a failure: say so, where a screen reader will read it.
  useEffect(() => {
    if (failed) status.current?.focus();
  }, [failed]);

  // Sent back with a problem: take the reader to the first one. Sent: forget the draft.
  useEffect(() => {
    if (state.status === "sent") {
      try {
        sessionStorage.removeItem(DRAFT);
      } catch {}
    }
    if (state.status !== "invalid") return;
    const first = FIELDS.find(({ name }) => state.errors[name]);
    if (first) form.current?.querySelector<HTMLElement>(`[name="${first.name}"]`)?.focus();
  }, [state]);

  const errors = state.status === "invalid" ? state.errors : {};
  const values = "values" in state ? state.values : undefined;
  const message =
    state.status === "sent"
      ? "Sent. Thank you, I’ll write back soon."
      : state.status === "busy"
        ? "That’s a few in a row. Try again in a little while."
        : state.status === "failed"
          ? state.write
            ? `It didn’t go through. Write to ${state.write} instead.`
            : "It didn’t go through. Try again in a little while; what you wrote is kept."
          : failed
            ? "That didn’t go through. Check your connection and send it again, or reload the page; what you wrote is kept."
            : null;

  return (
    <form
      ref={form}
      action={action}
      className={s.form}
      onSubmit={(e) => {
        // One send at a time; the button stays focusable while it goes.
        if (pending) {
          e.preventDefault();
          return;
        }
        // The stopwatch: milliseconds from the page opening, by the browser's own clock.
        if (elapsed.current) elapsed.current.value = String(Math.round(performance.now()));
        try {
          const data = new FormData(e.currentTarget);
          sessionStorage.setItem(DRAFT, JSON.stringify(Object.fromEntries(FIELDS.map(({ name }) => [name, data.get(name)]))));
        } catch {}
      }}
    >
      {FIELDS.map(({ name, label, hint, autoComplete, type }) => {
        const id = `message-${name}`;
        const error = errors[name];
        const props = {
          id,
          name,
          autoComplete,
          placeholder: hint,
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
      <input ref={elapsed} type="hidden" name="elapsed" />

      <div className={s.send}>
        <button type="submit" aria-disabled={pending || undefined}>
          {pending ? "Sending…" : "Send"}
        </button>
        {/* Emptied while sending, so the same result twice is still announced twice. */}
        <p role="status" ref={status} tabIndex={failed ? -1 : undefined} className={s.status}>
          {!pending && message}
        </p>
      </div>
    </form>
  );
}
