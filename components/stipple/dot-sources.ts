// Where the page's dots are: each stipple canvas registers a source, and a
// page transition (the hyperspace jump) reads them all at once to launch its
// streaks from the dots actually on screen.

/** Some dots on screen and how they look. */
export interface DotSnapshot {
  /** [x, y] pairs, in client (viewport) CSS px. */
  pos: Float32Array;
  /** [diameter (CSS px), opacity] pairs; opacity 0 means hidden. */
  attrs: Float32Array;
  count: number;
}

type Source = () => DotSnapshot | null;

const sources = new Set<Source>();

/** Registers a source of dots; returns its release. */
export function registerDotSource(source: Source): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** Every registered source's dots, as they are now. */
export function snapshotDots(): DotSnapshot[] {
  const out: DotSnapshot[] = [];
  for (const source of sources) {
    const snap = source();
    if (snap && snap.count > 0) out.push(snap);
  }
  return out;
}
