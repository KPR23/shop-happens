import { CONVEYOR, INTERACT_RANGE, CASHIER_ZONE, DOOR, PICKUP_RANGE, VAN_ZONE, type Rect } from "./constants";
import { ECON, FIXTURES, HOLD, handsMultiplier } from "./content";
import { pointInRect } from "./geometry";
import type { PlayerData, WorldView } from "./types";

export type InteractionKind = "pickup" | "put" | "unpack" | "take" | "stock" | "scan" | "drive" | "open" | "info";

export interface Interaction {
  kind: InteractionKind;
  targetId: string;
  /** Seconds the player has to hold E. 0 = instant (tap). */
  duration: number;
  /** Shown to the player, e.g. "Hold: stock the shelf". */
  label: string;
}

export function distToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(0, r.minZ - z, z - r.maxZ);
  return Math.hypot(dx, dz);
}

export function beltHasRoom(w: WorldView): boolean {
  for (const b of w.boxes.values()) if (b.state === "onConveyor" && b.progress < CONVEYOR.minGap) return false;
  return true;
}

/**
 * Single source of truth for "what does E do for this worker right now?".
 * The client uses it for hints; the server uses it to decide (and validate) the real action.
 */
export function resolveInteraction(w: WorldView, p: PlayerData): Interaction | null {
  if (p.away) return null;
  const mult = handsMultiplier(w.upgrades.hands);
  const held = p.heldBoxId ? w.boxes.get(p.heldBoxId) : undefined;
  const near = (id: string) => {
    const f = FIXTURES.find((x) => x.id === id)!;
    return distToRect(p.x, p.z, f.rect) <= INTERACT_RANGE;
  };

  if (held) {
    if (held.type === "crate") {
      for (const f of FIXTURES) {
        if (f.type !== "rack" || !near(f.id)) continue;
        if ((w.fixtures.get(f.id)?.stock ?? 0) + held.units <= f.capacity) {
          return { kind: "unpack", targetId: f.id, duration: HOLD.unpack * mult, label: "Hold: unpack crate into the rack" };
        }
      }
      if (Math.hypot(p.x - CONVEYOR.start.x, p.z - CONVEYOR.start.z) <= CONVEYOR.inputRadius && beltHasRoom(w)) {
        return { kind: "put", targetId: "belt", duration: 0, label: "Put crate on the belt" };
      }
    } else {
      for (const f of FIXTURES) {
        if (f.type !== "shelf" || !near(f.id)) continue;
        if ((w.fixtures.get(f.id)?.stock ?? 0) + held.units <= f.capacity) {
          return { kind: "stock", targetId: f.id, duration: HOLD.stock * mult, label: "Hold: put goods on the shelf" };
        }
      }
    }
    return { kind: "put", targetId: "", duration: 0, label: "Set the box down" };
  }

  let best: { id: string; d: number; type: string } | null = null;
  for (const b of w.boxes.values()) {
    if (b.state !== "available" && b.state !== "onConveyor") continue;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d <= PICKUP_RANGE - 0.3 && (!best || d < best.d)) best = { id: b.id, d, type: b.type };
  }

  // cashier: front customer is waiting at the register and this worker stands behind it
  if (pointInRect(p.x, p.z, CASHIER_ZONE)) {
    for (const c of w.customers.values()) {
      if (c.slot === 0 && c.state === "waiting") {
        return { kind: "scan", targetId: c.id, duration: Math.max(1, c.items) * HOLD.scanPerItem * mult, label: "Hold: scan the customer's items" };
      }
    }
  }
  if (best) return { kind: "pickup", targetId: best.id, duration: 0, label: `Pick up ${best.type === "crate" ? "crate" : "goods"}` };
  for (const f of FIXTURES) {
    if (f.type === "rack" && near(f.id) && (w.fixtures.get(f.id)?.stock ?? 0) >= ECON.trayUnits) {
      return { kind: "take", targetId: f.id, duration: HOLD.take * mult, label: "Hold: take a tray of goods" };
    }
  }
  if (pointInRect(p.x, p.z, VAN_ZONE)) {
    if (w.van.state === "away") return { kind: "info", targetId: "", duration: 0, label: `Van is out, back in ${Math.ceil(w.van.left)}s` };
    if (w.money < ECON.vanCost) return { kind: "info", targetId: "", duration: 0, label: `Wholesaler trip costs $${ECON.vanCost}` };
    return { kind: "drive", targetId: "van", duration: HOLD.drive * mult, label: `Hold: drive to the wholesaler ($${ECON.vanCost})` };
  }
  if (w.phase === "prep" && Math.hypot(p.x - DOOR.x, p.z - DOOR.z) <= 2) {
    return { kind: "open", targetId: "door", duration: HOLD.open * mult, label: "Hold: open the store now" };
  }
  return null;
}
