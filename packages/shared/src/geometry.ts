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
