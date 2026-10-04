"use server";

import { MAX_MESSAGE_LENGTH, type MessageState } from "@/lib/message";

/**
 * Receives a message from the landing page's message box.
 *
 * If CONTACT_WEBHOOK_URL is set, the message is POSTed there as JSON
 * (`content` for Discord, `text` for Slack, `message` for anything else).
 * Otherwise it is only written to the server log.
 */
export async function sendMessage(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const at = Date.now();

  // Honeypot: a field humans never see. Pretend success so bots move on.
  if (formData.get("website")) return { status: "sent", at };

  const message = String(formData.get("message") ?? "").trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return { status: "error", at };
  }

  const webhook = process.env.CONTACT_WEBHOOK_URL;
  if (!webhook) {
    console.info("[message]", message);
    return { status: "sent", at };
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Discord: visitor text must never ping anyone.
        content: message,
        allowed_mentions: { parse: [] },
        // Slack: escape control characters so <!channel> etc. stay literal.
        text: message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        message,
      }),
    });
    return { status: res.ok ? "sent" : "error", at };
  } catch {
    return { status: "error", at };
  }
}
