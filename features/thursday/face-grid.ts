import { hash, smoothstep as ss } from "./ascii.const";
import { CELL_H, CELL_W, DESIGN } from "./components/ascii-orb";
import { fbm, vnoise } from "./field";

/**
 * Her grid carried out to a field wider than her canvas, for what stands over her face
 * (face-moment): the globe (here-globe) is drawn cell for cell where her own glyphs are, so it
 * meets her without a seam.
 */

/**
 * The field a moment is drawn in, placed inside the box her face is laid out in
 * (thursday.tsx): her canvas's height, and twice its width where the window has room.
 */
export const MOMENT_FIELD =
  "absolute top-[calc(-1*var(--face-bleed))] bottom-[calc(-1*var(--face-bleed))] left-1/2 w-[min(calc(2*(100%+2*var(--face-bleed))),calc(100vw-2rem))] -translate-x-1/2";

export type Grid = {
  width: number;
  height: number;
  /** px per reference unit (ascii-orb DESIGN): her canvas is the frame's height. */
  k: number;
  /** The unit the weather and the marks are sized in, px. */
  p: number;
  cols: number;
  rows: number;
  /** Her column and row of the first cell: her grid carried out to the frame's edges. */
  col0: number;
  row0: number;
  left: number;
  top: number;
  n: number;
  x: Float32Array;
  y: Float32Array;
  /** From the centre, reference units. */
  dx: Float32Array;
  dy: Float32Array;
  gx: Int32Array;
  gy: Int32Array;
  seed: Float32Array;
  grain: Float32Array;
  /** How near the frame's edge, 0 at the centre to 1 at it (a rounded rectangle). */
  edge: Float32Array;
  /** Noise the frame's edge is broken with. */
  fray: Float32Array;
  /** Over her canvas: where her face is under what is drawn. */
  onFace: Uint8Array;
};

export function buildGrid(width: number, height: number): Grid {
  const face = height;
  const k = face / DESIGN;
  // her cells sit at c·w + w/2 from her canvas's left; the frame is centred on her
  const left = (width - face) / 2;
  const top = (height - face) / 2;
  const col0 = Math.ceil(-left / CELL_W);
  const col1 = Math.floor((width - left) / CELL_W) - 1;
  const row0 = Math.ceil(-top / CELL_H);
  const row1 = Math.floor((height - top) / CELL_H) - 1;
  const cols = col1 - col0 + 1;
  const rows = row1 - row0 + 1;
  const n = cols * rows;
  const grid: Grid = {
    width,
    height,
    k,
    p: Math.max(6.5, Math.min(10, face / 44)),
    cols,
    rows,
    col0,
    row0,
    left,
    top,
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    dx: new Float32Array(n),
    dy: new Float32Array(n),
    gx: new Int32Array(n),
    gy: new Int32Array(n),
    seed: new Float32Array(n),
    grain: new Float32Array(n),
    edge: new Float32Array(n),
    fray: new Float32Array(n),
    onFace: new Uint8Array(n),
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const gx = col0 + c;
      const gy = row0 + r;
      const x = left + gx * CELL_W + CELL_W / 2;
      const y = top + gy * CELL_H + CELL_H / 2;
      const fx = (x - width / 2) / (width / 2);
      const fy = (y - height / 2) / (height / 2);
      grid.x[i] = x;
      grid.y[i] = y;
      grid.dx[i] = (x - width / 2) / k;
      grid.dy[i] = (y - height / 2) / k;
      grid.gx[i] = gx;
      grid.gy[i] = gy;
      grid.seed[i] = hash(gx * 1.7, gy * 2.3);
      grid.grain[i] = hash(gx + 31.3, gy + 17.9);
      grid.edge[i] = (fx ** 4 + fy ** 4) ** 0.25;
      grid.fray[i] = vnoise(gx * 0.2, gy * 0.26, 0);
      grid.onFace[i] =
        Math.abs(x - width / 2) <= face / 2 &&
        Math.abs(y - height / 2) <= face / 2
          ? 1
          : 0;
    }
  return grid;
}

/**
 * A small living cluster of glyphs round (cx, cy), `R` in radius, the way her body is: how much
 * of one a cell is, 0 to 1. The globe's sun and moon are drawn so.
 */
export function bodyAt(
  g: Grid,
  i: number,
  R: number,
  cx: number,
  cy: number,
  t: number,
) {
  if (R <= 0) return 0;
  const dx = g.dx[i] - cx;
  const dy = g.dy[i] - cy;
  const d = Math.hypot(dx, dy);
  if (d > R * 1.6) return 0;
  const nz = fbm(dx * 0.0085 + 3.1, dy * 0.0085, t * 0.32, 3);
  const edge = R * (0.86 + 0.34 * nz);
  let v = ss(edge, edge * 0.45, d);
  if (v < 0.25 && g.seed[i] < 0.3) {
    const halo = ss(edge * 1.4, edge, d);
    if (halo > 0)
      v = Math.max(
        v,
        halo * 0.35 * (0.5 + 0.5 * Math.sin(t * 1.7 + g.seed[i] * 40)),
      );
  }
  return v * (0.78 + 0.22 * g.grain[i]);
}
