"use server";

import { headers } from "next/headers";
import { LIMITS, type Field, type Sent, type Values } from "./message";

/**
 * The contact form's delivery. Messages go to CONTACT_TO by email, through
 * Resend's HTTP API, from CONTACT_FROM (an address on a domain verified with
 * Resend), with the sender's address as the reply-to. Set in the host's env:
 *
 *   RESEND_API_KEY   re_…
 *   CONTACT_FROM     "Konstantin Stanmeyer <site@…>"
 *   CONTACT_TO       the inbox messages go to
 *
 * The address never appears in the page; it is only shown, as a fallback,
 * to someone whose message failed to send. Without a key, in development,
 * a message is written to the server log instead of sent.
 */

// Faster than this from opening the page to sending, it was not typed.
const QUICKEST_MS = 2500;

// Five messages per address per ten minutes. Kept in this server's memory,
// so on a host that runs several instances it is a floor, not a guarantee.
const WINDOW_MS = 10 * 60 * 1000;
const PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function limited(who: string, now: number) {
  const times = (recent.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) {
    recent.set(who, times);
    return true;
  }
  times.push(now);
  recent.set(who, times);
  // Forget the quiet ones now and then, so the map never grows without end.
  if (recent.size > 5000) {
    for (const [key, list] of recent) if (!list.some((t) => now - t < WINDOW_MS)) recent.delete(key);
  }
  return false;
}

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export async function sendMessage(_: Sent, data: FormData): Promise<Sent> {
  const now = Date.now();

  // The honeypot, and the stopwatch: a bot that fills the hidden field, or
  // sends within moments of loading the page, is told it worked and dropped.
  // The stopwatch is set by the page's script, so it only judges browsers
  // that ran it; without one, the honeypot alone decides.
  if (text(data, "website") !== "") return { status: "sent" };
  const opened = text(data, "opened");
  if (opened !== "") {
    const at = Number(opened);
    if (!Number.isFinite(at) || now - at < QUICKEST_MS) return { status: "sent" };
  }

  const values: Values = {
    name: text(data, "name").trim().slice(0, LIMITS.name),
    email: text(data, "email").trim().slice(0, LIMITS.email),
    message: text(data, "message").trim(),
  };

  const errors: Partial<Record<Field, string>> = {};
  if (!values.name) errors.name = "Add your name.";
  if (!EMAIL.test(values.email)) errors.email = "Add an email address I can reply to.";
  if (!values.message) errors.message = "Add a message.";
  else if (values.message.length > LIMITS.message)
    errors.message = `Keep it under ${LIMITS.message.toLocaleString("en-US")} characters.`;
  if (Object.keys(errors).length) return { status: "invalid", errors, values };

  const request = await headers();
  const who = request.get("x-forwarded-for")?.split(",")[0]?.trim() || request.get("x-real-ip") || "unknown";
  if (limited(who, now)) return { status: "busy", values };

  const to = process.env.CONTACT_TO ?? "";
  const from = process.env.CONTACT_FROM;
  const key = process.env.RESEND_API_KEY;
  // One line, so a name can never add a header of its own.
  const name = values.name.replace(/[\r\n\t]+/g, " ");
  const subject = `${name}, from the site`;
  const body = `${name} <${values.email}> wrote, from the site:\n\n${values.message}\n`;

  if (!key || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[contact] Not sent (RESEND_API_KEY or CONTACT_FROM unset). To ${to}:\n${subject}\n\n${body}`);
      return { status: "sent" };
    }
    console.error("[contact] RESEND_API_KEY or CONTACT_FROM is not set; a message could not be sent.");
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
