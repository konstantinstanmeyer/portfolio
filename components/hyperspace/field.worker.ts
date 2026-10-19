// Draws the hyperspace overlay off the main thread, so the frames keep coming
// while the arriving page mounts and sets up its own canvases.

import { StarField, type Frames, type FromField, type ToFieldWorker } from "./field";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToFieldWorker>) => void) | null;
  postMessage(message: FromField): void;
  requestAnimationFrame?: (callback: (now: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
};

// Workers get animation frames in most browsers; a plain timer otherwise.
const raf = scope.requestAnimationFrame?.bind(scope);
const caf = scope.cancelAnimationFrame?.bind(scope);
const frames: Frames =
  raf && caf
    ? { request: raf, cancel: caf }
    : {
        request: (callback) => self.setTimeout(() => callback(performance.now()), 16),
        cancel: (id) => self.clearTimeout(id),
      };

let field: StarField | null = null;

scope.onmessage = ({ data }) => {
  if (data.type === "init") {
    field = new StarField(data.canvas, frames);
    return;
  }
  if (!field?.handle(data)) scope.postMessage({ type: "failed" });
};
