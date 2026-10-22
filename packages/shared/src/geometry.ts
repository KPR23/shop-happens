import { OBSTACLES, PLAYER_RADIUS, WORLD, type Rect } from "./constants";

export function circleHitsRect(x: number, z: number, r: number, rect: Rect): boolean {
  const cx = Math.max(rect.minX, Math.min(x, rect.maxX));
  const cz = Math.max(rect.minZ, Math.min(z, rect.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function pointInRect(x: number, z: number, rect: Rect): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

export function isWalkable(x: number, z: number, r = PLAYER_RADIUS): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (x < WORLD.minX + r || x > WORLD.maxX - r || z < WORLD.minZ + r || z > WORLD.maxZ - r) return false;
  for (const key in OBSTACLES) if (circleHitsRect(x, z, r, OBSTACLES[key])) return false;
  return true;
}

/** Axis-separated move so players slide along walls and shelves. */
export function resolveMove(x: number, z: number, nx: number, nz: number): { x: number; z: number } {
  let rx = x;
  let rz = z;
  if (isWalkable(nx, rz)) rx = nx;
  if (isWalkable(rx, nz)) rz = nz;
  return { x: rx, z: rz };
}

/** Nudge a point out of obstacles (used for dropped boxes), falling back to `fallback`. */
export function nearestFreeSpot(
  x: number,
  z: number,
  fallback: { x: number; z: number },
  r = 0.35,
): { x: number; z: number } {
  if (isWalkable(x, z, r)) return { x, z };
  for (let ring = 1; ring <= 6; ring++) {
    const d = ring * 0.25;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = x + Math.cos(ang) * d;
      const pz = z + Math.sin(ang) * d;
      if (isWalkable(px, pz, r)) return { x: px, z: pz };
    }
  }
  return { ...fallback };
}

export function conveyorPoint(progress: number, start: { x: number; z: number }, end: { x: number; z: number }, length: number) {
  const t = Math.max(0, Math.min(1, progress / length));
  return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
}

// ---- customer navigation: BFS over a coarse walkable grid --------------------------------------
const CELL = 0.5;
const COLS = Math.round((WORLD.maxX - WORLD.minX) / CELL);
const ROWS = Math.round((WORLD.maxZ - WORLD.minZ) / CELL);
let navGrid: Uint8Array | null = null;
const cellCenter = (c: number, r: number) => ({ x: WORLD.minX + (c + 0.5) * CELL, z: WORLD.minZ + (r + 0.5) * CELL });

function grid() {
  if (!navGrid) {
    navGrid = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const p = cellCenter(c, r);
        navGrid[r * COLS + c] = isWalkable(p.x, p.z, 0.3) ? 1 : 0;
      }
  }
  return navGrid;
}

function cellOf(x: number, z: number) {
  return {
    c: Math.max(0, Math.min(COLS - 1, Math.floor((x - WORLD.minX) / CELL))),
    r: Math.max(0, Math.min(ROWS - 1, Math.floor((z - WORLD.minZ) / CELL))),
  };
}

/** Shortest 8-connected path as world points (excluding the start). Falls back to a straight line. */
export function findPath(sx: number, sz: number, tx: number, tz: number): Array<{ x: number; z: number }> {
  const g = grid();
  const s = cellOf(sx, sz);
  const t = cellOf(tx, tz);
  const prev = new Int32Array(COLS * ROWS).fill(-2);
  const start = s.r * COLS + s.c;
  const goal = t.r * COLS + t.c;
  const queue = [start];
  prev[start] = -1;
  for (let qi = 0; qi < queue.length && prev[goal] === -2; qi++) {
    const cur = queue[qi];
    const cc = cur % COLS;
    const cr = (cur / COLS) | 0;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const ni = nr * COLS + nc;
        if (prev[ni] !== -2 || !g[ni]) continue;
        if (dr && dc && (!g[cr * COLS + nc] || !g[nr * COLS + cc])) continue; // no corner cutting
        prev[ni] = cur;
        queue.push(ni);
      }
  }
  if (prev[goal] === -2) return [{ x: tx, z: tz }];
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = prev[i]) cells.push(i);
  cells.reverse();
  const pts = cells.slice(1, -1).map((i) => cellCenter(i % COLS, (i / COLS) | 0));
  pts.push({ x: tx, z: tz });
  return pts;
}

/**
 * Pushes `b` out of `a` (when they overlap) by `share` of the overlap, and `a` by the remainder.
 * Each side only moves if the new spot is walkable. Returns the corrected positions.
 */
export function separateCircles(
  a: { x: number; z: number },
  b: { x: number; z: number },
  diameter: number,
  shareForB: number,
): { a: { x: number; z: number }; b: { x: number; z: number } } {
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  let d = Math.hypot(dx, dz);
  if (d >= diameter) return { a, b };
  if (d < 1e-4) {
    dx = 1;
    dz = 0;
    d = 1;
  }
  const overlap = diameter - Math.hypot(b.x - a.x, b.z - a.z);
  const nx = dx / d;
  const nz = dz / d;
  let pb = overlap * shareForB;
  let pa = overlap - pb;
  const nb = { x: b.x + nx * pb, z: b.z + nz * pb };
  const na = { x: a.x - nx * pa, z: a.z - nz * pa };
  if (!isWalkable(nb.x, nb.z)) {
    pa += pb; // bystander is against a wall: the mover absorbs everything
    pb = 0;
  }
  const finalA = { x: a.x - nx * pa, z: a.z - nz * pa };
  const finalB = pb ? nb : { x: b.x, z: b.z };
  return { a: isWalkable(finalA.x, finalA.z) ? finalA : isWalkable(na.x, na.z) ? na : { x: a.x, z: a.z }, b: finalB };
}
