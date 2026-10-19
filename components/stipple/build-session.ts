// One stipple build worker for a page's stippled pieces (e.g. the About
// paragraph). Every component that stipples registers while mounted; builds
// run one session at a time (the worker remembers the last name it shaded,
// and titles are dealt from it, so a name and its titles must not interleave
// with anyone else's build). The worker is let go once the page has been idle
// for a moment, or as soon as the last component unmounts, and is started
// again on demand.

import { createBuilder, type Builder } from "./build-client";

const IDLE_MS = 4000;

let worker: Builder | null = null;
let mounted = 0;
let busy = 0;
let idleTimer = 0;
let generation = 0;
let tail: Promise<void> = Promise.resolve();

function retire(): void {
  window.clearTimeout(idleTimer);
  worker?.dispose();
  worker = null;
  busy = 0;
  generation++;
  tail = Promise.resolve();
}

/** Registers a component that builds; returns its release. */
export function registerBuilds(): () => void {
  mounted++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounted = Math.max(0, mounted - 1);
    if (mounted === 0) retire();
  };
}

/** Runs `work` with the worker to itself. Rejects if the page tore it down meanwhile. */
export function buildSession<T>(work: (builder: Builder) => Promise<T>): Promise<T> {
  const mine = generation;
  window.clearTimeout(idleTimer);
  busy++;
  const run = tail.then(() => {
    if (mine !== generation) throw new Error("stipple builder retired");
    worker ??= createBuilder();
    return work(worker);
  });
  tail = run.then(
    () => {},
    () => {},
  );
  const done = () => {
    if (mine !== generation) return;
    busy = Math.max(0, busy - 1);
    if (busy === 0) idleTimer = window.setTimeout(retire, IDLE_MS);
  };
  run.then(done, done);
  return run;
}
