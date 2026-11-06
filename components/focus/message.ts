// Shared by the contact form and its server action.

export type Field = "name" | "email" | "message";
export type Values = Record<Field, string>;

export type Sent =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "invalid"; errors: Partial<Record<Field, string>>; values: Values }
  | { status: "busy"; values: Values }
  // write: where to send it instead, when the inbox is configured.
  | { status: "failed"; write?: string; values: Values };

// The longest each field may be, in characters.
export const LIMITS: Record<Field, number> = { name: 120, email: 254, message: 5000 };
