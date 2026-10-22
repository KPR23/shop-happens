import {
  BOX_SPAWNS,
  CARRY_DISTANCE,
  CONVEYOR,
  CONVEYOR_LENGTH,
  DELIVERED_LINGER_MS,
  DELIVERY_TARGET,
  MAX_PLAYERS,
  ORDER_ZONE,
  PICKUP_RANGE,
  PLAYER_SPAWNS,
  PLAYER_SPEED,
  ROUND_RESET_MS,
  SPEED_TOLERANCE,
} from "./constants";
import { conveyorPoint, isWalkable, nearestFreeSpot, pointInRect } from "./geometry";
import type { BoxData, Phase, PlayerData, SimEvent, WorldView } from "./types";

/**
 * Authoritative game rules. Pure TypeScript with no I/O or rendering, so the
 * Colyseus room and the offline single-player mode run exactly the same code.
 */
export class GameSim implements WorldView {
  players = new Map<string, PlayerData>();
  boxes = new Map<string, BoxData>();
  delivered = 0;
  target = DELIVERY_TARGET;
  phase: Phase = "playing";
  onEvent?: (e: SimEvent) => void;

  private nextBoxId = 1;
  private lastMoveAt = new Map<string, number>();
  private removeAt = new Map<string, number>();
  private resetAt = 0;

  constructor() {
    this.refillBoxes();
  }

  addPlayer(id: string, name: string): PlayerData | null {
    if (this.players.has(id) || this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.colorIndex));
    let colorIndex = 0;
    while (used.has(colorIndex)) colorIndex++;
    const spawn = PLAYER_SPAWNS[colorIndex % PLAYER_SPAWNS.length];
    const p: PlayerData = { id, name, colorIndex, x: spawn.x, z: spawn.z, rot: Math.PI, heldBoxId: "" };
    this.players.set(id, p);
    return p;
  }

  /** Releases any carried box so it never stays locked to a missing player. */
  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.heldBoxId) this.releaseToFloor(p);
    this.players.delete(id);
    this.lastMoveAt.delete(id);
  }

  /** Client-reported movement; rejected when out of bounds, inside solids or too fast. */
  move(id: string, x: number, z: number, rot: number, now: number): boolean {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(rot)) return false;
    if (!isWalkable(x, z)) return false;
    const last = this.lastMoveAt.get(id) ?? now - 100;
    const dt = Math.min(Math.max((now - last) / 1000, 0.03), 0.5);
    const maxDist = PLAYER_SPEED * SPEED_TOLERANCE * dt + 0.3;
    if (Math.hypot(x - p.x, z - p.z) > maxDist) return false;
    this.lastMoveAt.set(id, now);
    p.x = x;
    p.z = z;
    p.rot = rot;
    return true;
  }

  pickup(id: string, boxId: string): boolean {
    const p = this.players.get(id);
    const b = this.boxes.get(boxId);
    if (!p || !b || p.heldBoxId) return false;
    if (b.state !== "available" && b.state !== "onConveyor") return false;
    if (Math.hypot(b.x - p.x, b.z - p.z) > PICKUP_RANGE) return false;
    b.state = "held";
    b.heldBy = id;
    p.heldBoxId = b.id;
    this.placeHeld(p, b);
    return true;
  }

  /** `drop` = plain floor drop (Q). Otherwise a smart put-down: order zone, belt input, or floor. */
  put(id: string, drop: boolean): boolean {
    const p = this.players.get(id);
    const b = p && this.boxes.get(p.heldBoxId);
    if (!p || !b || b.state !== "held") return false;
    const fx = p.x + Math.sin(p.rot) * CARRY_DISTANCE;
    const fz = p.z + Math.cos(p.rot) * CARRY_DISTANCE;
    p.heldBoxId = "";
    b.heldBy = "";

    if (pointInRect(fx, fz, ORDER_ZONE) || pointInRect(p.x, p.z, ORDER_ZONE)) {
      b.x = fx;
      b.z = fz;
      this.deliver(b, id, this.clock);
      return true;
    }
    if (!drop && Math.hypot(p.x - CONVEYOR.start.x, p.z - CONVEYOR.start.z) <= CONVEYOR.inputRadius && this.beltHasRoom()) {
      b.state = "onConveyor";
      b.progress = 0;
      b.x = CONVEYOR.start.x;
      b.z = CONVEYOR.start.z;
      return true;
    }
    const spot = nearestFreeSpot(fx, fz, { x: p.x, z: p.z });
    b.state = "available";
    b.x = spot.x;
    b.z = spot.z;
    return true;
  }

  private clock = 0;

  tick(dt: number, now: number): void {
    this.clock = now;

    for (const p of this.players.values()) {
      const b = p.heldBoxId ? this.boxes.get(p.heldBoxId) : undefined;
      if (b) this.placeHeld(p, b);
    }

    // Conveyor: deterministic constant-speed motion along the path, no rigid bodies.
    const belt = [...this.boxes.values()].filter((b) => b.state === "onConveyor").sort((a, b) => b.progress - a.progress);
    let limit = Infinity;
    for (const b of belt) {
      b.progress = Math.min(b.progress + CONVEYOR.speed * dt, limit);
      limit = b.progress - CONVEYOR.minGap;
      if (b.progress >= CONVEYOR_LENGTH) {
        this.deliver(b, "", now);
        continue;
      }
      const pt = conveyorPoint(b.progress, CONVEYOR.start, CONVEYOR.end, CONVEYOR_LENGTH);
      b.x = pt.x;
      b.z = pt.z;
    }

    for (const [id, at] of this.removeAt) {
      if (now >= at) {
        this.boxes.delete(id);
        this.removeAt.delete(id);
      }
    }

    if (this.phase === "complete" && now >= this.resetAt) this.reset();
    else if (this.phase === "playing") this.refillBoxes();
  }

  private deliver(b: BoxData, by: string, now: number): void {
    if (b.state === "delivered") return; // guards against duplicate rewards
    b.state = "delivered";
    b.heldBy = "";
    if (by === "") {
      b.x = CONVEYOR.end.x + 1.2;
      b.z = CONVEYOR.end.z;
    }
    this.delivered++;
    this.removeAt.set(b.id, now + DELIVERED_LINGER_MS);
    this.onEvent?.({ type: "delivered", boxId: b.id, by, count: this.delivered, x: b.x, z: b.z });
    if (this.delivered >= this.target && this.phase === "playing") {
      this.phase = "complete";
      this.resetAt = now + ROUND_RESET_MS;
      this.onEvent?.({ type: "complete" });
    }
  }

  private reset(): void {
    for (const p of this.players.values()) p.heldBoxId = "";
    this.boxes.clear();
    this.removeAt.clear();
    this.delivered = 0;
    this.phase = "playing";
    this.refillBoxes();
    this.onEvent?.({ type: "reset" });
  }

  private placeHeld(p: PlayerData, b: BoxData): void {
    b.x = p.x + Math.sin(p.rot) * CARRY_DISTANCE;
    b.z = p.z + Math.cos(p.rot) * CARRY_DISTANCE;
  }

  private releaseToFloor(p: PlayerData): void {
    const b = this.boxes.get(p.heldBoxId);
    p.heldBoxId = "";
    if (!b) return;
    const spot = nearestFreeSpot(p.x, p.z, { x: p.x, z: p.z });
    b.state = "available";
    b.heldBy = "";
    b.x = spot.x;
    b.z = spot.z;
  }

  private beltHasRoom(): boolean {
    for (const b of this.boxes.values()) if (b.state === "onConveyor" && b.progress < CONVEYOR.minGap) return false;
    return true;
  }

  private refillBoxes(): void {
    let active = 0;
    for (const b of this.boxes.values()) if (b.state !== "delivered") active++;
    for (const s of BOX_SPAWNS) {
      if (active >= BOX_SPAWNS.length) break;
      const taken = [...this.boxes.values()].some((b) => b.state === "available" && Math.hypot(b.x - s.x, b.z - s.z) < 0.8);
      if (taken) continue;
      const id = `box-${this.nextBoxId++}`;
      this.boxes.set(id, { id, x: s.x, z: s.z, state: "available", heldBy: "", progress: 0, kind: this.nextBoxId % 3 });
      active++;
    }
  }
}
