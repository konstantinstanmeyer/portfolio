"use server";

import { headers } from "next/headers";
import { LIMITS, type Field, type Sent, type Values } from "./message";

/**
 * The contact form's delivery. Messages go to CONTACT_TO by email, through
 * Resend's HTTP API, from CONTACT_FROM (an address on a domain verified with
 * Resend), with the sender's address as the reply-to. Set in the host's env:
 *
 *   RESEND_API_KEY   re_…
 *   CONTACT_FROM     "Konstantin Stanmeyer <site@…>", on the verified domain
 *   CONTACT_TO       the inbox messages go to
 *
 * The addresses live only there, never in this code (the repository is
 * public) or the page; CONTACT_TO is only shown, as a fallback, to someone
 * whose message failed to send. Without them, in development, a message is
 * written to the server log instead of sent.
 */

// Faster than this from opening the page to sending, it was not typed.
const QUICKEST_MS = 2500;

// Five messages per sender per ten minutes, and fifty from everyone, so a
// sender who disguises where they are can still never flood the inbox or
// spend the sending quota. Kept in this server's memory, so on a host that
// runs several instances it is a floor, not a guarantee.
const WINDOW_MS = 10 * 60 * 1000;
const PER_SENDER = 5;
const PER_WINDOW = 50;
// Senders remembered at most; past this the longest-quiet are forgotten.
const SENDERS = 2000;
const recent = new Map<string, number[]>();
let everyone: number[] = [];

function limited(who: string, now: number) {
  everyone = everyone.filter((t) => now - t < WINDOW_MS);
  const times = (recent.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_SENDER || everyone.length >= PER_WINDOW) return true;
  times.push(now);
  everyone.push(now);
  // Moved to the end, so the map runs from longest-quiet to latest.
  recent.delete(who);
  recent.set(who, times);
  while (recent.size > SENDERS) recent.delete(recent.keys().next().value!);
  return false;
}

/**
 * Who sent it, from a header the host sets and a sender cannot: on Vercel,
 * its own; elsewhere, the address the nearest proxy appended last. With no
 * proxy at all (a bare `next start`) every header is the sender's own word,
 * and only the overall ceiling holds.
 */
function sender(request: Awaited<ReturnType<typeof headers>>) {
  if (process.env.VERCEL) return request.get("x-real-ip") || "unknown";
  return request.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}

// A bot's message: told it worked, and dropped, with a line in the log so
// a person caught by mistake would show up there.
function trapped(by: string): Sent {
  console.info(`[contact] Dropped a message as a bot's (${by}).`);
  return { status: "sent" };
}

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export async function sendMessage(_: Sent, data: FormData): Promise<Sent> {
  const now = Date.now();

  // The honeypot, and the stopwatch: a bot that fills the hidden field, or
  // sends within moments of the page opening, is caught. The stopwatch is
  // the browser's own count from opening to sending, so no two clocks need
  // agree; without the page's script there is none, and the honeypot alone
  // decides.
  if (text(data, "website") !== "") return trapped("honeypot");
  const elapsed = text(data, "elapsed");
  if (elapsed !== "" && !(Number(elapsed) >= QUICKEST_MS)) return trapped("too quick");

  const values: Values = {
    name: text(data, "name").trim().slice(0, LIMITS.name),
    email: text(data, "email").trim().slice(0, LIMITS.email),
    // Line breaks as the browser counts them, one character each.
    message: text(data, "message").replace(/\r\n?/g, "\n").trim(),
  };

  const errors: Partial<Record<Field, string>> = {};
  if (!values.name) errors.name = "Add your name.";
  if (!EMAIL.test(values.email)) errors.email = "Add an email address I can reply to.";
  if (!values.message) errors.message = "Add a message.";
  else if (values.message.length > LIMITS.message)
    errors.message = `Keep it under ${LIMITS.message.toLocaleString("en-US")} characters.`;
  if (Object.keys(errors).length) return { status: "invalid", errors, values };

  if (limited(sender(await headers()), now)) return { status: "busy", values };

  const to = process.env.CONTACT_TO;
  const from = process.env.CONTACT_FROM;
  const key = process.env.RESEND_API_KEY;
  // One line, so a name can never add a header of its own.
  const name = values.name.replace(/[\r\n\t]+/g, " ");
  const subject = `${name}, from the site`;
  const body = `${name} <${values.email}> wrote, from the site:\n\n${values.message}\n`;

  if (!key || !from || !to) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[contact] Not sent (RESEND_API_KEY, CONTACT_FROM or CONTACT_TO unset):\n${subject}\n\n${body}`);
      return { status: "sent" };
    }
    console.error("[contact] RESEND_API_KEY, CONTACT_FROM or CONTACT_TO is not set; a message could not be sent.");
    return { status: "failed", write: to, values };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: values.email, subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
    return { status: "sent" };
  } catch (error) {
    console.error("[contact] A message could not be sent.", error);
    return { status: "failed", write: to, values };
  }
}
