export type MessageState = {
  status: "idle" | "sent" | "error";
  // Changes on every submission so the UI can replay its feedback animation.
  at: number;
};

export const initialMessageState: MessageState = { status: "idle", at: 0 };

export const MAX_MESSAGE_LENGTH = 2000;
