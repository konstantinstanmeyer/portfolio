import { METRICS } from "./metrics";
import { createSolver } from "./solver";

/** Inline script: lays the name out from the metric tables before first paint. */
export const BOOT = `try{(${createSolver.toString()})(${JSON.stringify(METRICS)}).boot(document.querySelector("[data-axis-root]"))}catch(e){}`;
