// Shades masks into stipple targets off the main thread. It keeps the newest
// name build, so titles (sent after it) are dealt from the same dots.

import { finishName, finishTitle, type NameJob, type StippleTargets, type TitleJob, type TitleTargets } from "./stipple";

export type ToBuild = { type: "name"; id: number; job: NameJob } | { type: "title"; id: number; job: TitleJob };
export type FromBuild =
  | { type: "name"; id: number; targets: StippleTargets }
  | { type: "title"; id: number; title: TitleTargets | null };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToBuild>) => void) | null;
  postMessage(message: FromBuild, transfer?: Transferable[]): void;
};

let current: StippleTargets | null = null;

scope.onmessage = ({ data }) => {
  if (data.type === "name") {
    current = finishName(data.job);
    scope.postMessage({ type: "name", id: data.id, targets: current });
  } else {
    const title = current ? finishTitle(current, data.job) : null;
    scope.postMessage(
      { type: "title", id: data.id, title },
      title ? [title.home.buffer, title.attrs.buffer] : [],
    );
  }
};
