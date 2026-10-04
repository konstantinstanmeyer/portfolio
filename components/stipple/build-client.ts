// Finishes stipple builds in a worker when it can, so shading the name and
// titles never freezes the page; on the main thread otherwise.

import type { FromBuild, ToBuild } from "./build.worker";
import { finishName, finishTitle, type NameJob, type StippleTargets, type TitleJob, type TitleTargets } from "./stipple";

export interface Builder {
  /** True when builds run off the main thread. */
  readonly background: boolean;
  name(job: NameJob): Promise<StippleTargets>;
  /** Deals the newest name's dots onto a title. */
  title(job: TitleJob): Promise<TitleTargets | null>;
  dispose(): void;
}

function localBuilder(): Builder {
  let current: StippleTargets | null = null;
  return {
    background: false,
    async name(job) {
      current = finishName(job);
      return current;
    },
    async title(job) {
      return current ? finishTitle(current, job) : null;
    },
    dispose() {},
  };
}

export function createBuilder(): Builder {
  if (typeof Worker === "undefined") return localBuilder();
  let worker: Worker;
  try {
    worker = new Worker(new URL("./build.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return localBuilder();
  }
  let id = 0;
  let local: Builder | null = null;
  // Jobs in flight, kept (not transferred) so a fallback can redo them in order.
  const pending = new Map<number, { message: ToBuild; resolve: (value: never) => void }>();
  const send = <T>(message: ToBuild): Promise<T> =>
    new Promise<T>((resolve) => {
      pending.set(message.id, { message, resolve: resolve as (value: never) => void });
      worker.postMessage(message);
    });
  worker.onmessage = ({ data }: MessageEvent<FromBuild>) => {
    const job = pending.get(data.id);
    pending.delete(data.id);
    job?.resolve((data.type === "name" ? data.targets : data.title) as never);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    worker.terminate();
    local = localBuilder();
    const fallback = local;
    for (const [, { message, resolve }] of [...pending].sort((a, b) => a[0] - b[0])) {
      (message.type === "name" ? fallback.name(message.job) : fallback.title(message.job)).then(resolve as never);
    }
    pending.clear();
  };
  return {
    get background() {
      return local === null;
    },
    name(job) {
      return local ? local.name(job) : send<StippleTargets>({ type: "name", id: ++id, job });
    },
    title(job) {
      return local ? local.title(job) : send<TitleTargets | null>({ type: "title", id: ++id, job });
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}
