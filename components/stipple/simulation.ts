// Lagrangian particle model for the stippled name, adapted from the smell lab
// (ai-slop/testing-smell). Each dot is a parcel that, per fixed sub-step:
//   • is advected by a divergence-free "air" field  x += u(x, t) · dt
//   • random-walks (Brownian diffusion)             x += N(0, 2·D·dt)
//   • is pulled home by a damped, saturating spring (its spot in the name)
//   • is pushed and stirred by the pointer
//   • while the pointer is held, accelerates toward the hold point; the pull
//     grows with hold time and the home spring lets go, then returns on release.

import { EXTRA_GROUP, type ShapeField, type StippleTargets } from "./stipple";

/** The parts of a build the simulation needs (no looks, no layout basis). */
export type SimTargets = Pick<StippleTargets, "count" | "home" | "group" | "icons" | "iconField" | "blockHeight">;

// The simulation advances by each frame's own elapsed time (one step per
// frame, split only when a frame runs long), so motion stays in lockstep
// with the display at any refresh rate instead of stuttering against a
// fixed step. Steps never exceed these sizes, which every force tolerates.
const MAX_STEP = 1 / 60;
const IDLE_MAX_STEP = 1 / 30;
const MAX_FRAME_DT = 1 / 20;
const MAX_SPEED = 3200; // px/s

// Home spring: per-dot natural frequency (Hz) and damping ratio.
const FREQ_MIN = 0.55;
const FREQ_MAX = 0.95;
const DAMPING_RATIO = 0.62;
// Beyond this distance the spring stops growing, so far dots glide home
// instead of snapping back.
const SPRING_SATURATION = 240;

// Ambient air: speed of the drifting current and Brownian diffusivity.
const FLOW_SPEED = 8; // px/s
const DIFFUSIVITY = 0.6; // px²/s
const FLOW_CELL = 40; // px between flow-grid nodes

// Pointer push and stir.
const REPEL_ACCEL = 9000; // px/s² at the cursor
const STIR = 5; // 1/s coupling to cursor velocity

// Click-and-hold gravity.
const HOLD_ACCEL = 1700; // px/s² at the moment of pressing
const HOLD_GROWTH = 1.6; // extra multiple per second held
const HOLD_MAX = 6; // cap on that multiple
const HOLD_CORE = 0.09; // core radius as a share of the shorter viewport side
const HOLD_SWIRL = 0.32; // tangential share, so the swarm orbits as it falls in
const HOLD_SPIN = 0.6; // extra tangential share near the core, so it eddies
// Near the core the swarm churns in its own small, fast, divergence-free
// eddies (the smell lab's air again, at a finer scale) plus extra Brownian
// fizz, so it reads as a living cloud rather than a solid disc.
const TURB_SPEED = 320; // px/s at the centre
const TURB_REACH = 2.4; // envelope radius, in core radii
const TURB_FIZZ = 520; // px²/s extra diffusivity at the centre
const TURB_RAMP = 0.6; // s to reach full strength after pressing
const TURB_NODES = 28; // turbulence grid resolution per side
const TURB_GRID = 1.6; // grid half-size, in TURB_REACH; covers the whole falloff
// While held and resting, the swarm blooms around the cursor: a soft round
// clearing that slowly breathes, ringed by a thin haze, with everyone else
// churning around it in wavy arms.
const BLOOM_RADIUS = 0.4; // clearing radius, in core radii (everything else is too)
const BLOOM_BREATH = 0.08; // how far the clearing swells and settles
const BLOOM_BREATH_HZ = 0.2; // breaths per second
const BLOOM_OPEN = 0.55; // s for the clearing to open
const BLOOM_CLOSE = 0.4; // s for it to close again once the cursor moves fast
const BLOOM_DELAY = 0.35; // s the cursor must be slow before it opens
// It rides out small, slow movements, gliding after the cursor; only a quick
// flick (like mouse acceleration kicking in) closes it. Two thresholds so it
// doesn't flutter around one speed.
const BLOOM_FAST = 900; // px/s that closes it
const BLOOM_SLOW = 320; // px/s the cursor must drop under to count as resting
const BLOOM_FOLLOW = 0.2; // s for the bloom to glide after a slowly moving cursor
const BLOOM_SPEED_SMOOTH = 0.08; // s of smoothing on the cursor speed
const BLOOM_CALM = 0.37; // distance from the edge over which turbulence fades in
const BLOOM_CALM_FLOOR = 0.2; // share of the turbulence that still reaches the edge
const BLOOM_FEATHER = 0.1; // clearing radii dots may sink inside the edge, so it fades
// Only as many dots as it takes form the ring: a haze that thins away from
// the clearing's edge. Everyone else is pushed out into a wide field that
// thins with distance, so the crowd never packs into a hard white rim.
const RING_DENSITY = 0.75; // dots per px² right at the edge
const RING_DEPTH = 0.12; // haze falloff scale
const RING_FLOW = 0.035; // laps per second, so the ring keeps circulating
const RING_CHURN = 0.2; // share of the turbulence the ring feels
// The ring changes members: dots within RING_JOIN of the edge can join it,
// and members that end up more than RING_DROP from their place (the bloom
// moved on) drop back to the outer field, so it re-forms wherever the cursor
// is instead of dragging the same dots along.
const RING_JOIN = 0.45;
const RING_DROP = 0.75;
// Members are pulled straight in or out from the bloom's centre (so a moving
// bloom closes its old hole instead of hauling its shape across), plus this
// much of a sideways nudge toward their slot, which keeps coverage even.
const SLOT_NUDGE = 0.3;
// The ring forms first: while it has room, dots arriving at the bloom go to
// it rather than the outer field, all moving at the same speed as everyone
// else. Each sector of the ring has its own share of room, so arrivals from
// one side don't fill it lopsided; dots that find their sector full keep
// swirling round until they reach one that isn't.
const RING_SECTORS = 36;
// While the bloom glides, its dots hold tighter (up to this many times the
// stiffness, reached at about BLOOM_KEEP_UP px/s) so the shape keeps pace with
// the clearing instead of trailing behind it.
const BLOOM_GRIP_MAX = 6;
const BLOOM_KEEP_UP = 140;
const DUST_START = 1.3; // inner edge of the outer field
const DUST_DEPTH = 1.12; // falloff scale (half-normal, so it fades with no edge)
const DUST_CHURN = 0.5; // share of the turbulence the outer field feels
// Neither the clearing nor the field is round: their outlines wobble with a
// few slow harmonics (amplitude per harmonic 2, 3, 4), so the shape morphs
// like smoke and the currents curl it into uneven, wavy arms, not a cog.
const CLEAR_WOBBLE = [0.09, 0.055, 0.03];
const FIELD_WOBBLE = [0.3, 0.2, 0.1];
const WOBBLE_HZ = [0.05, 0.07, 0.09]; // how fast each harmonic turns
// Each press re-rolls the bloom's character: its eddies, outline phases and
// strengths (within this range), which way it turns, and where dealing
// starts, so no two look alike while the zones stay as distinct.
const WOBBLE_VARY = [0.65, 1.35];
const CLEAR_VARY = [0.85, 1.15]; // the clearing varies less, so its edge stays legible
// Within the opening: dots drift to their spots over the first part, and the
// clearing parts after a moment, so the crowd never gets shoved aside.
const BLOOM_SETTLE = 0.5; // share of the opening spent settling
const BLOOM_PART_FROM = 0.15; // share of the opening before the clearing starts to part
const SETTLE_FREQ = 1.1; // Hz, how quickly dots settle into their spots
const SETTLE_DAMPING = 0.8; // damping ratio for settling
// How close a dot must come to join the bloom.
const BLOOM_CATCH = 2;
// Pushing dots out of the clearing: strength per px inside (1/s²) at rest,
// the glide speed (px/s) that halves it so the edge smears and lags while it
// moves, and the share of inward speed shed each step.
const BLOOM_PUSH = 3000;
const BLOOM_PUSH_DRIFT = 110;
const BLOOM_BRAKE = 0.25;
// Spots are dealt in arrival order at golden-angle spacing, so the bloom
// fills evenly however lopsided the swarm arrives.
const GOLDEN = 0.6180339887;
const ROLE_FREE = 0;
const ROLE_RING = 1;
const ROLE_DUST = 2;
const HOLD_RELEASE = 0.45; // s for the home spring to fade while held
const RETURN_TIME = 0.28; // s for the home spring to come back after release

// First-load fly-in: dots start past the left edge and are let go on a stagger
// that sweeps across the name, riding a gust of the same air current (plus a
// tailwind) that fades as the name forms.
const ENTER_SPREAD = 1.3; // s between the first and last release
const ENTER_JITTER = 0.2; // share of each release time left to chance rather than position
const ENTER_DEPTH = 180; // px, how far past the edge a dot may start
const ENTER_BAND = 0.3; // vertical spread of the incoming stream, × name height
const GUST = 90; // peak multiple of the ambient current
const GUST_HOLD = 1.8; // s at full strength
const GUST_FADE = 0.6; // s decay time constant afterwards
const GUST_REACH = 160; // px from home inside which a dot is sheltered from it
const TAILWIND = 420; // px/s at full gust, behind dots still short of their column
const GUST_WIDTH = 1200; // px of viewport width below which the gust scales down

// How much a hovered icon swells.
const ICON_HOVER_SCALE = 1.14;
// ...and loosens: each dot drifts out by up to this fraction of the icon size,
// a little outward-biased so it reads as growth rather than noise.
const ICON_HOVER_SCATTER = 0.045;
// Hovered icon dots surge back and forth along the icon's strokes in a wave
// that rolls around the icon: reach (fraction of icon size), rate, and how
// many crests fit around it. Bounded, so the shape and shading never drift.
const ICON_WAVE_REACH = 0.1;
const ICON_WAVE_HZ = 0.9;
const ICON_WAVE_CRESTS = 2;
// Hovered dots track their moving targets this much more tightly.
const ICON_GRIP = 4;
const ICON_GRIP_DAMP = Math.sqrt(ICON_GRIP);
// While a title stands in for the name, its dots spring a little more tightly
// so the swap feels responsive.
// A heartbeat (e.g. while the About icon is hovered): the name swells about
// its centre by up to BEAT_SCALE and settles, once per BEAT_PERIOD seconds,
// fading in and out over BEAT_RAMP. The dots follow on their springs.
const BEAT_SCALE = 0.05;
const BEAT_PERIOD = 1.05;
const BEAT_RAMP = 0.25;
const TITLE_GRIP = 2.5;
const TITLE_GRIP_DAMP = Math.sqrt(TITLE_GRIP);

// Pre-drawn standard normals; cheaper than Box–Muller per dot per step.
const GAUSS_SIZE = 8192;
const GAUSS = (() => {
  const table = new Float32Array(GAUSS_SIZE);
  for (let i = 0; i < GAUSS_SIZE; i += 2) {
    const u = Math.random() || 1e-9;
    const v = Math.random();
    const r = Math.sqrt(-2 * Math.log(u));
    table[i] = r * Math.cos(2 * Math.PI * v);
    table[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return table;
})();

/**
 * Moves every dot to a start point past the left edge, in a soft band around its
 * home row, and returns each dot's release time. Releases sweep left to right so
 * the name fills in reading order.
 */
function placeOutside(pos: Float32Array, home: Float32Array, n: number, height: number): Float32Array {
  const delay = new Float32Array(n);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, home[i * 2]);
    maxX = Math.max(maxX, home[i * 2]);
    minY = Math.min(minY, home[i * 2 + 1]);
    maxY = Math.max(maxY, home[i * 2 + 1]);
  }
  const span = Math.max(1, maxX - minX);
  const band = (maxY - minY) * ENTER_BAND + height * 0.06;
  for (let i = 0; i < n; i++) {
    const g = (Math.random() * GAUSS_SIZE) & (GAUSS_SIZE - 1);
    pos[i * 2] = -8 - Math.random() * ENTER_DEPTH;
    pos[i * 2 + 1] = home[i * 2 + 1] + GAUSS[g] * band;
    const sweep = (home[i * 2] - minX) / span;
    delay[i] = (sweep * (1 - ENTER_JITTER) + Math.random() * ENTER_JITTER) * ENTER_SPREAD;
  }
  return delay;
}

interface FlowMode {
  kx: number;
  ky: number;
  omega: number;
  phase: number;
  amp: number;
}

export class ParticleField {
  count = 0;
  /** Interleaved positions [x0, y0, ...], uploaded straight to the GPU. */
  pos: Float32Array = new Float32Array(0);
  private vel: Float32Array = new Float32Array(0);
  private home: Float32Array = new Float32Array(0);
  private group: Uint8Array = new Uint8Array(0);
  // Icon centres (index = group), and which icon is hovered (0 = none).
  private groupX: Float32Array = new Float32Array(1);
  private groupY: Float32Array = new Float32Array(1);
  private hovered = 0;
  // Each icon's title homes (index = icon), once built.
  private titleHomes: (Float32Array | null)[] = [];
  // Hover flow: each icon dot's moving target, the level line it follows,
  // and its own speed; plus the dots that make up each icon.
  private iconField: ShapeField | null = null;
  private flowHome: Float32Array = new Float32Array(0);
  private flowLevel: Float32Array = new Float32Array(0);
  private flowPhase: Float32Array = new Float32Array(0);
  private scatter: Float32Array = new Float32Array(0);
  private hoverTime = 0;
  private waveReach = 0;
  private members: Uint32Array[] = [];
  private stiffness: Float32Array = new Float32Array(0);
  private damping: Float32Array = new Float32Array(0);

  private width = 1;
  private height = 1;
  private time = 0;
  // The heartbeat: wanted or not, how far it has faded in, its phase, and the
  // dots it moves (from this index on) and their centre.
  private beatOn = false;
  private beatLevel = 0;
  private beatPhase = 0;
  private beatFrom = 0;
  private beatX = 0;
  private beatY = 0;
  private gaussIndex = 0;
  private springWeight = 1;
  private reducedMotion = false;
  /** Per-dot release time (s) during the fly-in. */
  private delay: Float32Array = new Float32Array(0);
  private introTime = 0;
  private introEnd = 0;
  private releaseUntil = 0;
  private gustScale = 1;
  /** Fastest dot speed (px/s) during the last step, to tell when things settle. */
  peakSpeed = 0;

  private flowModes: FlowMode[] = [];
  private turbModes: FlowMode[] = [];
  private turbU = new Float32Array(TURB_NODES * TURB_NODES);
  private turbV = new Float32Array(TURB_NODES * TURB_NODES);
  private coreRadius = 80;
  private flowCols = 0;
  private flowRows = 0;
  private flowU = new Float32Array(0);
  private flowV = new Float32Array(0);

  private pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  private hold = { x: 0, y: 0, active: false, time: 0 };
  // The bloom opens only where a held cursor comes to rest: its anchor, how
  // long the cursor has stayed slow, and how open it is (0–1).
  private bloom = { x: 0, y: 0, still: 0, open: 0, speed: 0, drift: 0, lastX: 0, lastY: 0, moving: false };
  // Each dot's part in the bloom, handed out first come, first served as it
  // opens: free (not yet arrived), ring, or the outer field once the ring is full.
  private bloomRole: Uint8Array = new Uint8Array(0);
  private ringQuota = 0;
  private ringTaken = 0;
  // Each ring member's sector, and how many members each sector has.
  private ringSector: Uint8Array = new Uint8Array(0);
  private sectorCount = new Uint16Array(RING_SECTORS);
  private sectorRoom = 0;
  private dustTaken = 0;
  private recruited = false;
  // Each dot's spot: where around the ring or field, and how far out.
  private ringPos: Float32Array = new Float32Array(0);
  private ringOut: Float32Array = new Float32Array(0);
  private dustOut: Float32Array = new Float32Array(0);
  private dustCos: Float32Array = new Float32Array(0);
  private dustSin: Float32Array = new Float32Array(0);
  // This step's outline wobble for the clearing and the field (see wobble()).
  private clearShape = new Float32Array(6);
  // Per-press variety (see rollVariety()): outline phase, strength and turn
  // direction per harmonic for each outline; spiral and spin directions; the
  // halo's starting angle, the breath's phase, and where dealing starts.
  private clearVary = new Float32Array(9);
  private fieldVary = new Float32Array(9);
  private swirlSign = 1;
  private spinSign = 1;
  private haloStart = 0;
  private breathStart = 0;
  private dealStart = 0;
  private fieldShape = new Float32Array(6);
  private repelRadius = 110;

  constructor() {
    // A few slow travelling waves; their stream function gives a
    // divergence-free current, as in the smell lab's room airflow.
    for (let i = 0; i < 4; i++) {
      const wavelength = 320 + Math.random() * 520;
      const angle = Math.random() * Math.PI * 2;
      const k = (2 * Math.PI) / wavelength;
      this.flowModes.push({
        kx: Math.cos(angle) * k,
        ky: Math.sin(angle) * k,
        omega: 0.15 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
        amp: FLOW_SPEED / k / 2,
      });
    }
    this.rollVariety();
  }

  /** Re-rolls the held core's eddies and the bloom's character (see WOBBLE_VARY). */
  private rollVariety(): void {
    // Small, quick eddies for the held core, in units of the core radius.
    this.turbModes = [];
    for (let i = 0; i < 4; i++) {
      const wavelength = 0.9 + Math.random() * 1.3;
      const angle = Math.random() * Math.PI * 2;
      const k = (2 * Math.PI) / wavelength;
      this.turbModes.push({
        kx: Math.cos(angle) * k,
        ky: Math.sin(angle) * k,
        omega: (2.5 + Math.random() * 2.5) * (i % 2 ? 1 : -1),
        phase: Math.random() * Math.PI * 2,
        amp: 1 / k / 2,
      });
    }
    for (const [vary, range] of [
      [this.clearVary, CLEAR_VARY],
      [this.fieldVary, WOBBLE_VARY],
    ] as const) {
      for (let k = 0; k < 3; k++) {
        vary[k * 3] = Math.random() * Math.PI * 2;
        vary[k * 3 + 1] = range[0] + Math.random() * (range[1] - range[0]);
        vary[k * 3 + 2] = Math.random() < 0.5 ? -1 : 1;
      }
    }
    this.swirlSign = Math.random() < 0.5 ? -1 : 1;
    this.spinSign = Math.random() < 0.5 ? -1 : 1;
    this.haloStart = Math.random() * Math.PI * 2;
    this.breathStart = Math.random() * Math.PI * 2;
    this.dealStart = Math.random();
  }

  /** Starts or stops the name's heartbeat; it moves the name's dots from index `from` on. */
  setBeat(on: boolean, from = 0): void {
    if (on && !this.beatOn) {
      // About the centre of the dots it moves (their homes' bounding box).
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = from; i < this.count; i++) {
        if (this.group[i] !== 0) continue;
        const x = this.home[i * 2];
        const y = this.home[i * 2 + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (x0 > x1) return;
      this.beatX = (x0 + x1) / 2;
      this.beatY = (y0 + y1) / 2;
      if (this.beatLevel === 0) this.beatPhase = 0;
    }
    this.beatOn = on;
    this.beatFrom = from;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced && this.entering) {
      // No fly-in under reduced motion: finish it on the spot.
      this.pos.set(this.home);
      this.vel.fill(0);
      this.introEnd = this.releaseUntil = 0;
    }
  }

  /** True while the first-load fly-in is still releasing or carrying dots. */
  get entering(): boolean {
    return this.introTime < this.introEnd;
  }

  /**
   * Point the dots at new homes. Existing dots keep their position and velocity
   * and glide to their new spots; on the first call, `spawn` says whether dots
   * fly in from beyond the viewport or simply appear at home.
   */
  setTargets(targets: SimTargets, width: number, height: number, spawn: "enter" | "home"): void {
    const prev = this.count;
    const n = targets.count;
    const home = targets.home;
    const enter = prev === 0 && spawn === "enter" && !this.reducedMotion;
    const pos = new Float32Array(n * 2);
    const vel = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      if (i < prev) {
        pos[i * 2] = this.pos[i * 2];
        pos[i * 2 + 1] = this.pos[i * 2 + 1];
        vel[i * 2] = this.vel[i * 2];
        vel[i * 2 + 1] = this.vel[i * 2 + 1];
      } else if (prev > 0) {
        const j = Math.floor(Math.random() * prev);
        pos[i * 2] = this.pos[j * 2];
        pos[i * 2 + 1] = this.pos[j * 2 + 1];
      } else {
        pos[i * 2] = home[i * 2];
        pos[i * 2 + 1] = home[i * 2 + 1];
      }
    }
    if (enter) {
      this.delay = placeOutside(pos, home, n, height);
      this.introTime = 0;
      this.releaseUntil = ENTER_SPREAD;
      // Same feel on a phone: the current shouldn't fling dots across it.
      this.gustScale = Math.max(0.35, Math.min(1, width / GUST_WIDTH));
      this.introEnd = Math.max(ENTER_SPREAD, GUST_HOLD) + GUST_FADE * 5;
    } else {
      // A re-target mid-flight lets every waiting dot go at once.
      this.releaseUntil = 0;
    }
    const stiffness = new Float32Array(n);
    const damping = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const omega = 2 * Math.PI * (FREQ_MIN + Math.random() * (FREQ_MAX - FREQ_MIN));
      stiffness[i] = omega * omega;
      damping[i] = 2 * DAMPING_RATIO * omega;
    }
    this.pos = pos;
    this.vel = vel;
    this.home = home;
    this.group = targets.group;
    this.groupX = new Float32Array(targets.icons.length + 1);
    this.groupY = new Float32Array(targets.icons.length + 1);
    targets.icons.forEach((r, i) => {
      this.groupX[i + 1] = r.left + r.width / 2;
      this.groupY[i + 1] = r.top + r.height / 2;
    });
    // Members of the name and of each icon (decoration dots are neither).
    const sizes = new Uint32Array(targets.icons.length + 1);
    for (let i = 0; i < n; i++) if (targets.group[i] < sizes.length) sizes[targets.group[i]]++;
    this.members = Array.from(sizes, (size) => new Uint32Array(size));
    sizes.fill(0);
    for (let i = 0; i < n; i++) {
      const g = targets.group[i];
      if (g < sizes.length) this.members[g][sizes[g]++] = i;
    }
    this.iconField = targets.iconField;
    this.flowHome = Float32Array.from(home);
    this.flowLevel = new Float32Array(n);
    this.flowPhase = new Float32Array(n);

    // Fixed per-dot hover offsets: mostly random, partly away from the centre.
    this.scatter = new Float32Array(n * 2);
    const reach = (targets.icons[0]?.width ?? 0) * ICON_HOVER_SCATTER;
    for (let i = 0; i < n; i++) {
      const g = targets.group[i];
      if (g === 0 || g >= this.groupX.length) continue;
      const ox = home[i * 2] - this.groupX[g];
      const oy = home[i * 2 + 1] - this.groupY[g];
      const len = Math.sqrt(ox * ox + oy * oy) || 1;
      const k = GAUSS_SIZE - 2;
      const j = (Math.random() * k) & ~1;
      this.scatter[i * 2] = reach * (GAUSS[j] * 0.8 + (ox / len) * 0.6);
      this.scatter[i * 2 + 1] = reach * (GAUSS[j + 1] * 0.8 + (oy / len) * 0.6);
    }
    this.waveReach = (targets.icons[0]?.width ?? 0) * ICON_WAVE_REACH;
    this.hovered = 0;
    // Like the hover, the heartbeat is set again for the new dots.
    this.beatOn = false;
    this.beatLevel = 0;
    this.titleHomes = [];
    this.stiffness = stiffness;
    this.damping = damping;
    this.count = n;
    this.width = width;
    this.height = height;
    this.repelRadius = Math.max(70, Math.min(150, targets.blockHeight * 0.55));
    this.coreRadius = Math.max(36, HOLD_CORE * Math.min(width, height));
    this.assignBloomRoles();

    this.flowCols = Math.ceil(width / FLOW_CELL) + 2;
    this.flowRows = Math.ceil(height / FLOW_CELL) + 2;
    this.flowU = new Float32Array(this.flowCols * this.flowRows);
    this.flowV = new Float32Array(this.flowCols * this.flowRows);
  }

  pointerMove(x: number, y: number, dt: number): void {
    const p = this.pointer;
    if (p.active && dt > 0) {
      // Smoothed cursor velocity, used to stir nearby dots.
      const k = Math.min(1, dt * 20);
      p.vx += ((x - p.x) / dt - p.vx) * k;
      p.vy += ((y - p.y) / dt - p.vy) * k;
    }
    p.x = x;
    p.y = y;
    p.active = true;
    if (this.hold.active) {
      this.hold.x = x;
      this.hold.y = y;
    }
  }

  pointerLeave(): void {
    this.pointer.active = false;
    this.pointer.vx = 0;
    this.pointer.vy = 0;
  }

  holdStart(x: number, y: number): void {
    this.hold = { x, y, active: true, time: 0 };
    // The ring starts forming straight away on a press; after a flick closes
    // it, it waits for the cursor to rest again.
    this.bloom = { x, y, still: BLOOM_DELAY, open: 0, speed: 0, drift: 0, lastX: x, lastY: y, moving: false };
    this.rollVariety();
    this.resetBloom();
  }

  /**
   * Sizes the ring's quota (enough dots for its haze to reach its density)
   * and draws each dot's random spot parameters.
   */
  private assignBloomRoles(): void {
    const n = this.count;
    const r = BLOOM_RADIUS * this.coreRadius;
    const depth = RING_DEPTH * this.coreRadius;
    // Area under a haze that falls off exponentially outward from radius r.
    this.ringQuota = Math.round(RING_DENSITY * 2 * Math.PI * (r * depth + depth * depth));
    this.bloomRole = new Uint8Array(n);
    this.ringPos = new Float32Array(n);
    this.ringOut = new Float32Array(n);
    this.ringSector = new Uint8Array(n);
    this.sectorRoom = Math.ceil(this.ringQuota / RING_SECTORS);
    this.dustOut = new Float32Array(n);
    this.dustCos = new Float32Array(n);
    this.dustSin = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.ringPos[i] = Math.random();
      // The haze starts just inside the edge so the clearing fades rather than cuts.
      this.ringOut[i] = -Math.log(1 - Math.random()) * RING_DEPTH - BLOOM_FEATHER * BLOOM_RADIUS * 0.5;
      this.dustOut[i] = Math.abs(GAUSS[(Math.random() * GAUSS_SIZE) | 0]) * DUST_DEPTH;
    }
    this.resetBloom();
  }

  /** Frees every dot from the bloom, so the next one recruits afresh. */
  private resetBloom(): void {
    this.bloomRole.fill(ROLE_FREE);
    this.ringTaken = 0;
    this.sectorCount.fill(0);
    this.dustTaken = 0;
    this.recruited = false;
  }

  holdEnd(): void {
    this.hold.active = false;
  }

  /** Hover icon `index` (0-based): it swells and its dots flow along its strokes. */
  hoverIcon(index: number | null): void {
    const g = index === null ? 0 : index + 1;
    if (g === this.hovered) return;
    this.hovered = g;
    const field = this.iconField;
    if (g === 0 || !field || !this.members[g]) return;
    // Start each dot's moving target at its home, on the level line through
    // it; its wave phase comes from where it sits around the icon's centre.
    this.hoverTime = 0;
    for (const i of this.members[g]) {
      const x = this.home[i * 2];
      const y = this.home[i * 2 + 1];
      this.flowHome[i * 2] = x;
      this.flowHome[i * 2 + 1] = y;
      this.flowLevel[i] = sampleField(field, (x - field.x) * field.scale, (y - field.y) * field.scale);
      this.flowPhase[i] = ICON_WAVE_CRESTS * Math.atan2(y - this.groupY[g], x - this.groupX[g]);
    }
  }

  /**
   * Slide the hovered icon's targets along the level lines of its distance
   * field. Those lines run parallel to every stroke, so the dots travel along
   * the icon's own paths and it keeps its shape.
   */
  private flowIcon(g: number, dt: number): void {
    const field = this.iconField;
    const members = this.members[g];
    if (!field || !members) return;
    const { flowHome, flowLevel, flowPhase, home } = this;
    const scale = field.scale;
    this.hoverTime += dt;
    const omega = 2 * Math.PI * ICON_WAVE_HZ;
    const wave = this.waveReach * omega;
    const t = this.hoverTime * omega;
    // A weak tether keeps numerical drift from building up over long hovers.
    const tether = Math.min(1, dt * 0.6);
    for (const i of members) {
      const gx = (flowHome[i * 2] - field.x) * scale;
      const gy = (flowHome[i * 2 + 1] - field.y) * scale;
      const dx = (sampleField(field, gx + 1, gy) - sampleField(field, gx - 1, gy)) * 0.5;
      const dy = (sampleField(field, gx, gy + 1) - sampleField(field, gx, gy - 1)) * 0.5;
      const g2 = dx * dx + dy * dy;
      // Near a stroke's centre line the field is flat and has no direction.
      if (g2 < 1e-4) continue;
      const len = Math.sqrt(g2);
      const step = wave * Math.cos(t - flowPhase[i]) * dt * Math.min(1, len / 0.3) * scale;
      let nx = gx - (dy / len) * step;
      let ny = gy + (dx / len) * step;
      // Newton step back onto the level line, so the drift never builds up.
      const err = flowLevel[i] - sampleField(field, nx, ny);
      const pull = Math.max(-1.5, Math.min(1.5, err / Math.max(g2, 0.05)));
      nx += dx * pull;
      ny += dy * pull;
      const fx = field.x + nx / scale;
      const fy = field.y + ny / scale;
      flowHome[i * 2] = fx + (home[i * 2] - fx) * tether;
      flowHome[i * 2 + 1] = fy + (home[i * 2 + 1] - fy) * tether;
    }
  }

  /** Where every dot goes while icon `index`'s title replaces the name. */
  setTitle(index: number, home: Float32Array): void {
    if (home.length !== this.count * 2) return;
    this.titleHomes[index] = home;
  }

  get holding(): boolean {
    return this.hold.active;
  }

  /** Radial kick from a point, e.g. when a message is sent. */
  pulse(x: number, y: number, strength = 900): void {
    if (this.reducedMotion) strength *= 0.15;
    for (let i = 0; i < this.count; i++) {
      const dx = this.pos[i * 2] - x;
      const dy = this.pos[i * 2 + 1] - y;
      const d = Math.sqrt(dx * dx + dy * dy) + 1;
      const kick = strength * Math.exp(-d / 500);
      this.vel[i * 2] += (dx / d) * kick;
      this.vel[i * 2 + 1] += (dy / d) * kick;
    }
  }

  /** Advances the simulation by `frameDt`; returns how many steps ran (0 = nothing moved). */
  step(frameDt: number, idle = false): number {
    const dt = Math.min(frameDt, MAX_FRAME_DT);
    this.peakSpeed = 0;
    if (dt <= 0) return 0;
    // 10% slack, so a frame that runs a hair long (vsync jitter) isn't split in two.
    const steps = Math.max(1, Math.ceil(dt / (idle ? IDLE_MAX_STEP : MAX_STEP) - 0.1));
    for (let k = 0; k < steps; k++) this.subStep(dt / steps);
    // Let the cursor's stir fade when it stops moving.
    this.pointer.vx *= 0.9;
    this.pointer.vy *= 0.9;
    return steps;
  }

  /** Eddy velocities (unit speed) on a small grid centred on the hold point. */
  private sampleTurbulence(): void {
    const t = this.time;
    const half = (TURB_NODES - 1) / 2;
    const cell = (TURB_REACH * TURB_GRID) / half; // in core radii
    for (let r = 0; r < TURB_NODES; r++) {
      const y = (r - half) * cell;
      for (let c = 0; c < TURB_NODES; c++) {
        const x = (c - half) * cell;
        let u = 0;
        let v = 0;
        for (const m of this.turbModes) {
          const cosine = Math.cos(m.kx * x + m.ky * y + m.omega * t + m.phase) * m.amp;
          u += m.ky * cosine;
          v -= m.kx * cosine;
        }
        this.turbU[r * TURB_NODES + c] = u;
        this.turbV[r * TURB_NODES + c] = v;
      }
    }
  }

  private sampleFlowGrid(): void {
    const cols = this.flowCols;
    const rows = this.flowRows;
    const t = this.time;
    for (let r = 0; r < rows; r++) {
      const y = (r - 1) * FLOW_CELL;
      for (let c = 0; c < cols; c++) {
        const x = (c - 1) * FLOW_CELL;
        let u = 0;
        let v = 0;
        for (const m of this.flowModes) {
          // ψ = A sin(k·x + ωt + φ)  →  u = ∂ψ/∂y, v = −∂ψ/∂x
          const cosine = Math.cos(m.kx * x + m.ky * y + m.omega * t + m.phase) * m.amp;
          u += m.ky * cosine;
          v -= m.kx * cosine;
        }
        this.flowU[r * cols + c] = u;
        this.flowV[r * cols + c] = v;
      }
    }
  }

  private subStep(dt: number): void {
    this.time += dt;
    const ambient = !this.reducedMotion;
    if (ambient) this.sampleFlowGrid();

    // The heartbeat's swell this step: a quick rise and a slower settle.
    const beatWanted = this.beatOn && ambient ? 1 : 0;
    if (this.beatLevel !== beatWanted) {
      const stepBy = dt / BEAT_RAMP;
      this.beatLevel = beatWanted ? Math.min(1, this.beatLevel + stepBy) : Math.max(0, this.beatLevel - stepBy);
    }
    let beat = 0;
    if (this.beatLevel > 0) {
      this.beatPhase = (this.beatPhase + dt / BEAT_PERIOD) % 1;
      const swell = Math.pow(Math.sin(Math.PI * this.beatPhase), 4);
      beat = BEAT_SCALE * swell * this.beatLevel;
    }
    const { beatFrom, beatX, beatY } = this;

    const hold = this.hold;
    if (hold.active) {
      hold.time += dt;
      this.springWeight = Math.max(0.02, this.springWeight * Math.exp(-dt / HOLD_RELEASE));
    } else {
      this.springWeight += (1 - this.springWeight) * (1 - Math.exp(-dt / RETURN_TIME));
    }
    const holdAccel = hold.active ? HOLD_ACCEL * Math.min(HOLD_MAX, 1 + HOLD_GROWTH * hold.time) : 0;
    const core = this.coreRadius;
    // Eddies grow with the pull so the core never packs into a solid disc.
    const churn =
      holdAccel > 0 && ambient
        ? Math.min(1, hold.time / TURB_RAMP) * Math.sqrt(holdAccel / HOLD_ACCEL)
        : 0;
    if (churn > 0) this.sampleTurbulence();
    const turbHalf = (TURB_NODES - 1) / 2;
    const turbCell = (core * TURB_REACH * TURB_GRID) / turbHalf; // px
    const turbReach2 = (core * TURB_REACH) ** 2;
    const { turbU, turbV, ringPos, ringOut, ringSector, sectorCount } = this;
    const sectorRoom = this.sectorRoom;
    const bloom = this.bloom;
    if (holdAccel > 0) {
      // Smoothed cursor speed decides: fast closes the bloom, slow lets it open.
      const mx = hold.x - bloom.lastX;
      const my = hold.y - bloom.lastY;
      bloom.lastX = hold.x;
      bloom.lastY = hold.y;
      bloom.speed += (Math.sqrt(mx * mx + my * my) / dt - bloom.speed) * (1 - Math.exp(-dt / BLOOM_SPEED_SMOOTH));
      if (bloom.speed > BLOOM_FAST) bloom.moving = true;
      else if (bloom.speed < BLOOM_SLOW) bloom.moving = false;
      // It glides after the cursor; while closed it keeps right up.
      const follow = 1 - Math.exp(-dt / (bloom.moving ? BLOOM_FOLLOW * 0.25 : BLOOM_FOLLOW));
      const fx = (hold.x - bloom.x) * follow;
      const fy = (hold.y - bloom.y) * follow;
      bloom.x += fx;
      bloom.y += fy;
      // How fast it is gliding, smoothed: it loosens the edge.
      bloom.drift += (Math.sqrt(fx * fx + fy * fy) / dt - bloom.drift) * (1 - Math.exp(-dt / BLOOM_SPEED_SMOOTH));
      bloom.still = bloom.moving ? 0 : bloom.still + dt;
      bloom.open =
        bloom.still >= BLOOM_DELAY
          ? Math.min(1, bloom.open + dt / BLOOM_OPEN)
          : Math.max(0, bloom.open - dt / BLOOM_CLOSE);
    } else {
      bloom.open = 0;
    }
    // Once a bloom has fully closed, its dots are free for the next one.
    if (bloom.open === 0 && this.recruited) this.resetBloom();
    const recruiting = bloom.open > 0;
    if (recruiting) this.recruited = true;
    const opening = ease(bloom.open / BLOOM_SETTLE);
    const partT = Math.min(1, Math.max(0, (bloom.open - BLOOM_PART_FROM) / (1 - BLOOM_PART_FROM)));
    const parting = 1 - (1 - partT) ** 3;
    const bloomR = BLOOM_RADIUS * core;
    // The clearing parts from a small hole and then slowly breathes.
    const breath = 1 + BLOOM_BREATH * Math.sin(2 * Math.PI * BLOOM_BREATH_HZ * hold.time + this.breathStart);
    const clearR = bloomR * (0.15 + 0.85 * parting) * breath;
    const clear = parting > 0; // whether the clearing pushes dots out yet
    const clearMax = 1 + CLEAR_WOBBLE[0] + CLEAR_WOBBLE[1] + CLEAR_WOBBLE[2];
    const bloomRole = this.bloomRole;
    const bloomPush = BLOOM_PUSH / (1 + bloom.drift / BLOOM_PUSH_DRIFT);
    const catch2 = (core * BLOOM_CATCH) ** 2;
    const keepUp = Math.min(BLOOM_GRIP_MAX, (1 + bloom.drift / BLOOM_KEEP_UP) ** 2);
    const settleK = (2 * Math.PI * SETTLE_FREQ) ** 2 * opening * keepUp;
    const settleC = 2 * SETTLE_DAMPING * 2 * Math.PI * SETTLE_FREQ * Math.sqrt(keepUp);
    const lap = RING_FLOW * hold.time * this.spinSign;
    const fizzKick = Math.sqrt(2 * TURB_FIZZ * dt);
    const haloCos = Math.cos(this.haloStart + Math.PI * lap);
    const haloSin = Math.sin(this.haloStart + Math.PI * lap);
    const dealStart = this.dealStart;
    const ringJoin = RING_JOIN * core;
    const ringDrop = RING_DROP * core;
    const swirlSign = this.swirlSign;
    const { dustCos, dustSin, dustOut } = this;
    const clearShape = this.clearShape;
    const fieldShape = this.fieldShape;
    wobble(clearShape, CLEAR_WOBBLE, this.clearVary, hold.time);
    wobble(fieldShape, FIELD_WOBBLE, this.fieldVary, hold.time);

    // Fly-in: hold back dots not yet released, and strengthen the current.
    let gust = 0;
    let tailwind = 0;
    let waiting = false;
    const introTime = this.introTime;
    if (introTime < this.introEnd) {
      this.introTime += dt;
      const strength =
        this.gustScale * (introTime < GUST_HOLD ? 1 : Math.exp(-(introTime - GUST_HOLD) / GUST_FADE));
      // A hold calms the wind (springWeight fades while held) so the swarm can gather.
      gust = (GUST - 1) * strength * this.springWeight;
      // The tailwind lasts the whole intro so the far end of wide names isn't late.
      tailwind = TAILWIND * this.gustScale * this.springWeight;
      waiting = introTime < this.releaseUntil;
    }
    const delay = this.delay;

    const p = this.pointer;
    const repel = p.active && !hold.active;
    const repelR = this.repelRadius;
    const stirR = repelR * 1.4;

    const sigma = ambient ? Math.sqrt(2 * DIFFUSIVITY * dt) : 0;
    const cols = this.flowCols;
    const maxCol = cols - 2;
    const maxRow = this.flowRows - 2;
    const { pos, vel, home, stiffness, damping, flowU, flowV, group, groupX, groupY } = this;
    const hovered = this.hovered;
    const title = hovered ? (this.titleHomes[hovered - 1] ?? null) : null;
    const flowHome = this.flowHome;
    const scatter = this.scatter;
    if (hovered && ambient) this.flowIcon(hovered, dt);
    const springWeight = this.springWeight;
    // Random start each step so neighbouring dots don't share noise sequences.
    let g = (this.gaussIndex + ((Math.random() * GAUSS_SIZE) | 0)) & (GAUSS_SIZE - 2);
    let peak2 = 0;
    // While a hold has let go of the home spring, skip measuring it.
    const springOn = springWeight > 0.03 || gust > 0;

    for (let i = 0; i < this.count; i++) {
      if (waiting && delay[i] > introTime) continue;
      const ix = i * 2;
      const iy = ix + 1;
      const x = pos[ix];
      const y = pos[iy];
      let vx = vel[ix];
      let vy = vel[iy];

      // Saturating home spring + damping. A hovered icon swells about its
      // centre, and its title takes over the name's dots.
      const owner = group[i];
      let tx = home[ix];
      let ty = home[iy];
      let grip = 1;
      let gripDamp = 1;
      // The name's dots, and the decoration's hidden ones, follow a title.
      const named = owner === 0 || owner === EXTRA_GROUP;
      if (named) {
        if (title) {
          tx = title[ix];
          ty = title[iy];
          grip = TITLE_GRIP;
          gripDamp = TITLE_GRIP_DAMP;
        }
        if (beat && i >= beatFrom) {
          tx = beatX + (tx - beatX) * (1 + beat);
          ty = beatY + (ty - beatY) * (1 + beat);
        }
      } else if (owner === hovered) {
        tx = groupX[owner] + (flowHome[ix] - groupX[owner]) * ICON_HOVER_SCALE + scatter[ix];
        ty = groupY[owner] + (flowHome[iy] - groupY[owner]) * ICON_HOVER_SCALE + scatter[iy];
        grip = ICON_GRIP;
        gripDamp = ICON_GRIP_DAMP;
      }
      const hx = tx - x;
      const hy = ty - y;
      const hd = springOn ? Math.sqrt(hx * hx + hy * hy) : 0;
      const k = springOn ? (stiffness[i] * springWeight * grip) / (1 + hd / SPRING_SATURATION) : 0;
      const c = damping[i] * gripDamp;
      let ax = k * hx - c * vx;
      let ay = k * hy - c * vy;

      // Dots jostled by a resting cursor never fully settle; leave them out of
      // the settle check so the loop can still go idle.
      let stirred = false;
      // Icons are links: they hold their shape under the cursor.
      if (repel && named) {
        const dx = x - p.x;
        const dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < stirR * stirR) {
          stirred = true;
          const d = Math.sqrt(d2) + 0.001;
          if (d < repelR) {
            const f = 1 - d / repelR;
            const push = REPEL_ACCEL * f * f;
            ax += (dx / d) * push;
            ay += (dy / d) * push;
          }
          const s = STIR * (1 - d / stirR);
          ax += (p.vx - vx) * s;
          ay += (p.vy - vy) * s;
        }
      }

      // Turbulent drift and extra fizz (0–1) for dots near a held core.
      let eddyX = 0;
      let eddyY = 0;
      let fizz = 0;
      if (holdAccel > 0) {
        const dx = hold.x - x;
        const dy = hold.y - y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) + 0.001;
        // Membership, first come, first served: dots near the opening bloom
        // join the ring if they're close to the clearing's edge and it has
        // room, otherwise the outer field. Ring members that fall away drop
        // back to the field, so the ring is always made of whoever is near.
        let uc = 0;
        let us = 0;
        let edge = 0;
        let fromEdge = 0;
        if (recruiting) {
          const ox = x - bloom.x;
          const oy = y - bloom.y;
          const or = Math.sqrt(ox * ox + oy * oy) + 0.001;
          uc = ox / or;
          us = oy / or;
          edge = clearR * shapeAt(clearShape, uc, us);
          fromEdge = or - edge;
          let role = bloomRole[i];
          if (role === ROLE_RING) {
            if (Math.abs(fromEdge - ringOut[i] * core) > ringDrop) {
              role = ROLE_DUST;
              sectorCount[ringSector[i]]--;
              this.ringTaken--;
            }
          } else if (owner !== EXTRA_GROUP && fromEdge < ringJoin && (role !== ROLE_FREE || or * or < catch2)) {
            // (Hidden decoration dots never make up the ring.)
            // Joiners take the slot where they already are, if its sector has room.
            let turn = Math.atan2(us, uc) / (2 * Math.PI);
            turn -= Math.floor(turn);
            const sector = Math.min(RING_SECTORS - 1, (turn * RING_SECTORS) | 0);
            if (sectorCount[sector] < sectorRoom) {
              role = ROLE_RING;
              sectorCount[sector]++;
              ringSector[i] = sector;
              this.ringTaken++;
              const t = turn - lap * (0.5 + ringOut[i]);
              ringPos[i] = t - Math.floor(t);
            }
          }
          // Arrivals hold off joining the field while the ring still has room
          // (or until the bloom has fully opened), so the ring forms first.
          if (
            role === ROLE_FREE &&
            or * or < catch2 &&
            (this.ringTaken >= this.ringQuota || bloom.open >= 1)
          ) {
            role = ROLE_DUST;
          }
          if (role === ROLE_DUST && bloomRole[i] !== ROLE_DUST) {
            // Field slots are dealt evenly around it too.
            const angle = 2 * Math.PI * ((this.dustTaken++ * GOLDEN + dealStart) % 1);
            dustCos[i] = Math.cos(angle);
            dustSin[i] = Math.sin(angle);
          }
          bloomRole[i] = role;
        }
        const role = bloomRole[i];
        // Dots that have joined trade the pull for a spring to their spot.
        const near = role === ROLE_FREE ? 0 : opening;
        let pullX = 0;
        let pullY = 0;
        if (near < 1) {
          // A wide, soft core: the pull fades inside it instead of crushing dots to a point.
          const soft = d / Math.sqrt(d2 + core * core);
          const swirl = (HOLD_SWIRL + HOLD_SPIN * Math.exp(-d / (core * 1.5))) * swirlSign;
          const nx = dx / d;
          const ny = dy / d;
          const k = holdAccel * soft * (1 - near);
          pullX = k * (nx - ny * swirl);
          pullY = k * (ny + nx * swirl);
        }
        if (near > 0) {
          let slotC: number;
          let slotS: number;
          let targetR: number;
          if (role === ROLE_DUST) {
            // The outer field: a wobbling blob whose slots turn slowly as a whole.
            slotC = dustCos[i] * haloCos - dustSin[i] * haloSin;
            slotS = dustSin[i] * haloCos + dustCos[i] * haloSin;
            targetR = (DUST_START * shapeAt(fieldShape, uc, us) + dustOut[i]) * core;
          } else {
            // The ring: around the clearing's edge, circulating slowly.
            const angle = 2 * Math.PI * (ringPos[i] + lap * (0.5 + ringOut[i]));
            slotC = Math.cos(angle);
            slotS = Math.sin(angle);
            targetR = edge + ringOut[i] * core;
          }
          // Straight in or out to its distance, leaning toward its slot, so
          // a moving bloom doesn't haul its shape along.
          const cross = uc * slotS - us * slotC;
          const along = uc * slotC + us * slotS > 0 ? cross : cross >= 0 ? 1 : -1;
          const nudge = along * targetR * SLOT_NUDGE;
          const tx = bloom.x + uc * targetR - us * nudge;
          const ty = bloom.y + us * targetR + uc * nudge;
          pullX += (settleK * (tx - x) - settleC * vx) * near;
          pullY += (settleK * (ty - y) - settleC * vy) * near;
        }
        ax += pullX;
        ay += pullY;
        if (churn > 0 && d2 < turbReach2 * 2.25) {
          // Calm near the clearing's edge so it reads as a shape (before the
          // bloom opens there's no edge to calm around).
          const calmFrom = recruiting ? fromEdge / core : 1;
          // The ring churns gently; the field around it churns into arms.
          const calm =
            (BLOOM_CALM_FLOOR + (1 - BLOOM_CALM_FLOOR) * ramp(0, BLOOM_CALM, calmFrom)) *
            (role === ROLE_RING ? RING_CHURN : role === ROLE_DUST ? DUST_CHURN : 1);
          // Compact falloff in place of a Gaussian: zero at the edge of the reach.
          const fall = 1 - d2 / (turbReach2 * 2.25);
          const envelope = churn * fall * fall * calm;
          const gx = Math.min(TURB_NODES - 1.001, Math.max(0, -dx / turbCell + turbHalf));
          const gy = Math.min(TURB_NODES - 1.001, Math.max(0, -dy / turbCell + turbHalf));
          const c0 = gx | 0;
          const r0 = gy | 0;
          const fx = gx - c0;
          const fy = gy - r0;
          const a = r0 * TURB_NODES + c0;
          const b = a + TURB_NODES;
          const u = (turbU[a] * (1 - fx) + turbU[a + 1] * fx) * (1 - fy) + (turbU[b] * (1 - fx) + turbU[b + 1] * fx) * fy;
          const v = (turbV[a] * (1 - fx) + turbV[a + 1] * fx) * (1 - fy) + (turbV[b] * (1 - fx) + turbV[b + 1] * fx) * fy;
          eddyX = u * TURB_SPEED * envelope;
          eddyY = v * TURB_SPEED * envelope;
          fizz = envelope;
        }
      }

      vx += ax * dt;
      vy += ay * dt;
      const speed2 = vx * vx + vy * vy;
      if (!stirred && speed2 > peak2) peak2 = speed2;
      if (speed2 > MAX_SPEED * MAX_SPEED) {
        const s = MAX_SPEED / Math.sqrt(speed2);
        vx *= s;
        vy *= s;
      }

      let nx = x + (vx + eddyX) * dt;
      let ny = y + (vy + eddyY) * dt;
      if (fizz > 0) {
        const kick = fizzKick * fizz;
        const j = (g + 4) & (GAUSS_SIZE - 2);
        nx += GAUSS[j] * kick;
        ny += GAUSS[j + 1] * kick;
      }
      if (ambient) {
        // Bilinear sample of the air current (grid has a one-cell margin).
        const gx = Math.min(maxCol, Math.max(0, x / FLOW_CELL + 1));
        const gy = Math.min(maxRow, Math.max(0, y / FLOW_CELL + 1));
        const c0 = gx | 0;
        const r0 = gy | 0;
        const fx = gx - c0;
        const fy = gy - r0;
        const a = r0 * cols + c0;
        const b = a + cols;
        const u = (flowU[a] * (1 - fx) + flowU[a + 1] * fx) * (1 - fy) + (flowU[b] * (1 - fx) + flowU[b + 1] * fx) * fy;
        const v = (flowV[a] * (1 - fx) + flowV[a + 1] * fx) * (1 - fy) + (flowV[b] * (1 - fx) + flowV[b + 1] * fx) * fy;
        let air = dt;
        if (gust > 0) {
          // The gust carries dots in flight; ones that have landed sit out of it,
          // and the tailwind only pushes dots still short of their column.
          const reach = Math.min(1, hd / GUST_REACH);
          air *= 1 + gust * reach * reach;
          const behind = Math.min(1, Math.max(0, hx / GUST_REACH));
          nx += behind * Math.max(tailwind, hx * 1.2 * springWeight) * dt;
        }
        nx += u * air + GAUSS[g] * sigma;
        ny += v * air + GAUSS[g + 1] * sigma;
        g = (g + 2 + ((i * 7) & 6)) & (GAUSS_SIZE - 2);
      }

      // The cloud is pushed out of the clearing rather than walled out: a soft
      // push that takes a moment, so the edge smears and lags when the bloom
      // moves instead of being one hard stencil.
      if (clear) {
        const ox = nx - bloom.x;
        const oy = ny - bloom.y;
        const r2 = ox * ox + oy * oy;
        const outer = clearR * clearMax;
        if (r2 < outer * outer) {
          const r = Math.sqrt(r2) + 0.001;
          const edge = clearR * shapeAt(clearShape, ox / r, oy / r);
          // Each dot may sink its own small way past the edge, so it fades
          // rather than being one hard line.
          let allow = ringPos[i] * 97.31;
          allow = (allow - (allow | 0)) * BLOOM_FEATHER * parting * bloomR;
          const depthIn = edge - r;
          if (depthIn > allow) {
            const ux = ox / r;
            const uy = oy / r;
            const push = bloomPush * (depthIn - allow) * dt;
            vx += ux * push;
            vy += uy * push;
            // Bleed off some of the inward speed so dots don't sail through.
            const vn = vx * ux + vy * uy;
            if (vn < 0) {
              vx -= vn * ux * BLOOM_BRAKE;
              vy -= vn * uy * BLOOM_BRAKE;
            }
          }
        }
      }

      pos[ix] = nx;
      pos[iy] = ny;
      vel[ix] = vx;
      vel[iy] = vy;
    }
    this.gaussIndex = g;
    this.peakSpeed = Math.max(this.peakSpeed, Math.sqrt(peak2));
  }
}

/** Bilinear sample of a shape field at grid coordinates, clamped to its edges. */
function sampleField(field: ShapeField, x: number, y: number): number {
  const { sdf, w, h } = field;
  const cx = Math.min(w - 1.001, Math.max(0, x));
  const cy = Math.min(h - 1.001, Math.max(0, y));
  const x0 = cx | 0;
  const y0 = cy | 0;
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * w + x0;
  const top = sdf[i] + (sdf[i + 1] - sdf[i]) * fx;
  const bottom = sdf[i + w] + (sdf[i + w + 1] - sdf[i + w]) * fx;
  return top + (bottom - top) * fy;
}

/** Smoothstep from edge0 to edge1 (either order). */
function ramp(edge0: number, edge1: number, x: number): number {
  return ease((x - edge0) / (edge1 - edge0));
}

/** Smoothstep easing of t, clamped to [0, 1]. */
function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Fills `out` with a blob outline's wobble at time t: for harmonics 2, 3 and 4,
 * amplitude × (cos, sin) of a slowly turning phase. `vary` holds this press's
 * starting phase, strength and turn direction for each harmonic.
 */
function wobble(out: Float32Array, amps: number[], vary: Float32Array, t: number): void {
  for (let k = 0; k < 3; k++) {
    const phase = vary[k * 3] + 2 * Math.PI * WOBBLE_HZ[k] * vary[k * 3 + 2] * t;
    const amp = amps[k] * vary[k * 3 + 1];
    out[k * 2] = amp * Math.cos(phase);
    out[k * 2 + 1] = amp * Math.sin(phase);
  }
}

/** A wobbled outline's radius scale in the unit direction (c, s). */
function shapeAt(w: Float32Array, c: number, s: number): number {
  const c2 = c * c - s * s;
  const s2 = 2 * c * s;
  const c3 = c * (4 * c * c - 3);
  const s3 = s * (3 - 4 * s * s);
  const c4 = c2 * c2 - s2 * s2;
  const s4 = 2 * s2 * c2;
  return 1 + w[0] * c2 + w[1] * s2 + w[2] * c3 + w[3] * s3 + w[4] * c4 + w[5] * s4;
}
