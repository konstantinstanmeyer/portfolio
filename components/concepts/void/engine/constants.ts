// Glyph atlas: square cells, each glyph drawn centred on its advance with
// its baseline at BASE_Y. Cells are CELL_EM ems wide so halos have room.
export const CELL = 128;
export const BASE = 64;
export const BASE_Y = 80;
export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
export const COLS = ATLAS_W / CELL;
export const CELLS = COLS * (ATLAS_H / CELL);
export const CELL_EM = CELL / BASE;
export const BASE_FRAC = BASE_Y / CELL;
export const SDF_SPREAD = 8;
export const CARET_CELL = 0;

export const FONT_WEIGHT = 230;
export const TRACKING = 0.014;
export const LINE_HEIGHT = 1.18;

// Vertical anchors, in ems relative to the baseline.
export const OPTICAL_Y = 0.45;
export const MID = 0.36;
export const FLOOR = 0.2;

// Instance layout: x, y, size, rot, heat, alpha, cell, refl, floorY.
export const STRIDE = 9;

export const HEAT_REST = 0.94;
