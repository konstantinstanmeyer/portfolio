// Icon shapes for the stippled icon row, painted into the stipple mask in a
// 32-unit box. Strokes are heavier than a UI icon's so they survive being
// inflated and drawn in dots; the shapes follow the Myrtle Street Media mark.

export type GlyphId = "person" | "myrtle" | "camera" | "notes";

const STROKE = 4.6;

const MYRTLE_ARCH = "M4.5 29.5V14.2a11.5 11.5 0 0 1 23 0v15.3";
const MYRTLE_STEM = "M16 27V11.5";
const MYRTLE_LEAF_RIGHT = "M16 20c0-4.1 2.8-6.9 6.9-7.3-.1 4.4-2.8 7-6.9 7.3Z";
const MYRTLE_LEAF_LEFT = "M16 14.6c0-4.1-2.8-6.9-6.9-7.3.1 4.4 2.8 7 6.9 7.3Z";
const CAMERA_BODY =
  "M2.5 12a3 3 0 0 1 3-3h4.6l2.2-3.6h7.4l2.2 3.6h4.6a3 3 0 0 1 3 3v14.5a3 3 0 0 1-3 3h-21a3 3 0 0 1-3-3Z";
const NOTES_STEMS = "M12.6 24V8.6M26.6 21.4V5.8";
const NOTES_BEAM = "M10.3 6.3 28.9 2.8v5L10.3 11.3Z";
// A head-and-shoulders bust, for "about".
const PERSON_SHOULDERS = "M4.5 29.5c0-6.6 5.1-11.2 11.5-11.2s11.5 4.6 11.5 11.2";

const PAINTERS: Record<GlyphId, (ctx: CanvasRenderingContext2D) => void> = {
  person(ctx) {
    ctx.beginPath();
    ctx.arc(16, 9.6, 5.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.stroke(new Path2D(PERSON_SHOULDERS));
  },
  myrtle(ctx) {
    ctx.stroke(new Path2D(MYRTLE_ARCH));
    ctx.stroke(new Path2D(MYRTLE_STEM));
    ctx.fill(new Path2D(MYRTLE_LEAF_RIGHT));
    ctx.fill(new Path2D(MYRTLE_LEAF_LEFT));
  },
  camera(ctx) {
    ctx.stroke(new Path2D(CAMERA_BODY));
    ctx.beginPath();
    ctx.arc(16, 19.2, 3.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(24.2, 14.4, 1.7, 0, Math.PI * 2);
    ctx.fill();
  },
  notes(ctx) {
    ctx.stroke(new Path2D(NOTES_STEMS));
    ctx.fill(new Path2D(NOTES_BEAM));
    for (const [cx, cy] of [
      [8.5, 24.9],
      [22.5, 22.3],
    ]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 4.5, 3.4, (-22 * Math.PI) / 180, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** Paints a glyph in white, `size` px square, with its top-left at (x, y). */
export function paintGlyph(ctx: CanvasRenderingContext2D, id: GlyphId, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  PAINTERS[id](ctx);
  ctx.restore();
}
