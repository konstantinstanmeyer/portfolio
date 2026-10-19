// Whether a page is arriving under a hyperspace jump. The jump's drop-out is
// the arriving page's entrance, so a page that mounts while this is true
// should start in place (dots at home) rather than play its own intro.

let landing = false;

/** True from the moment a jump changes the route until its overlay is gone. */
export function isLanding(): boolean {
  return landing;
}

/** Set by the jump itself. */
export function setLanding(value: boolean): void {
  landing = value;
}
