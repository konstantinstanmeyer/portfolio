// Mutable state shared between the React message box and the render loop.
// React writes on events; the renderer reads every frame without re-rendering.
export type SignalBridge = {
  // Bumped whenever the typed text, caret or scroll may have changed.
  boxVersion: number;
  // Char range [start, end) of the most recent insertion and when it happened.
  insertStart: number;
  insertEnd: number;
  insertAt: number;
  hover: boolean;
  transmitAt: number;
  feedback: "sent" | "error" | null;
  feedbackAt: number;
  rejectAt: number;
};

export function createBridge(): SignalBridge {
  return {
    boxVersion: 0,
    insertStart: 0,
    insertEnd: 0,
    insertAt: -1e9,
    hover: false,
    transmitAt: -1e9,
    feedback: null,
    feedbackAt: -1e9,
    rejectAt: -1e9,
  };
}
