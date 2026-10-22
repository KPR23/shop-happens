import { describe, expect, it } from "vitest";
import { CASHIER_ZONE, MAX_PLAYERS, QUEUE_SLOTS } from "./constants";
import { ECON, HOLD, TIMING } from "./content";
import { isWalkable, resolveMove } from "./geometry";
import { resolveInteraction } from "./interaction";
import { GameSim } from "./sim";
import type { SimEvent } from "./types";

/** Deterministic rng so customer behaviour is repeatable. */
function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
function setup() {
  const sim = new GameSim({ rng: seeded() });
  const events: SimEvent[] = [];
  sim.onEvent = (e) => events.push(e);
  sim.addPlayer("a", "A");
  sim.addPlayer("b", "B");
  return { sim, events };
}
const run = (sim: GameSim, secs: number, dt = 0.05) => {
  for (let t = 0; t < secs; t += dt) sim.tick(dt);
};
const place = (sim: GameSim, id: string, x: number, z: number, rot = 0) => Object.assign(sim.players.get(id)!, { x, z, rot });
const crates = (sim: GameSim) => [...sim.boxes.values()].filter((b) => b.type === "crate");
/** Stand next to rack A holding a crate. */
function carryCrateToRack(sim: GameSim, id = "a") {
  const crate = crates(sim)[0];
  place(sim, id, crate.x, crate.z + 0.8);
  expect(sim.pickup(id, crate.id)).toBe(true);
  place(sim, id, 9.5, -6.0);
  return crate;
}
function stockShelf(sim: GameSim, shelf: string, units = 12) {
  sim.fixtures.get(shelf)!.stock = units;
}
function openStore(sim: GameSim) {
  run(sim, TIMING.prep + 16);
  expect(sim.phase).toBe("open");
}

describe("players and carrying", () => {
  it("caps players at five", () => {
    const sim = new GameSim();
    for (let i = 0; i < MAX_PLAYERS; i++) expect(sim.addPlayer(`p${i}`, "x")).not.toBeNull();
    expect(sim.addPlayer("extra", "x")).toBeNull();
  });

  it("lets only one of two players pick up the same crate", () => {
    const { sim } = setup();
    const c = crates(sim)[0];
    place(sim, "a", c.x, c.z + 0.8);
    place(sim, "b", c.x, c.z - 0.8);
    expect(sim.pickup("a", c.id)).toBe(true);
    expect(sim.pickup("b", c.id)).toBe(false);
    expect(sim.boxes.get(c.id)!.heldBy).toBe("a");
  });

  it("rejects out-of-range pickup and a second carried box", () => {
    const { sim } = setup();
    const [c1, c2] = crates(sim);
    expect(sim.pickup("a", c1.id)).toBe(false);
    place(sim, "a", c1.x, c1.z + 0.8);
    expect(sim.pickup("a", c1.id)).toBe(true);
    place(sim, "a", c2.x, c2.z + 0.8);
    expect(sim.pickup("a", c2.id)).toBe(false);
  });

  it("releases the box and cancels the task when its carrier disconnects", () => {
    const { sim } = setup();
    const c = carryCrateToRack(sim);
    expect(sim.startHold("a")).not.toBeNull();
    sim.removePlayer("a");
    expect(sim.boxes.get(c.id)!.state).toBe("available");
    place(sim, "b", c.x, c.z + 0.8);
    expect(sim.pickup("b", c.id)).toBe(true);
  });

  it("rejects teleporting, out-of-bounds and inside-shelf moves", () => {
    const { sim } = setup();
    const a = sim.players.get("a")!;
    expect(sim.move("a", a.x + 0.1, a.z, 0, 1000)).toBe(true);
    expect(sim.move("a", a.x + 8, a.z, 0, 1050)).toBe(false);
    expect(sim.move("a", 100, 100, 0, 1100)).toBe(false);
    expect(sim.move("a", Number.NaN, 0, 0, 1150)).toBe(false);
    expect(isWalkable(1, 2.5)).toBe(false);
  });

  it("slides along obstacles instead of passing through", () => {
    const r = resolveMove(1, 1.4, 1, 2.2);
    expect(isWalkable(r.x, r.z)).toBe(true);
    expect(r.z).toBeLessThan(2);
  });

  it("throws a box a short way and lands it", () => {
    const { sim } = setup();
    const c = crates(sim)[0];
    place(sim, "a", c.x, c.z + 0.8);
    sim.pickup("a", c.id);
    place(sim, "a", 0, 6, Math.PI); // facing -z, lots of free floor
    expect(sim.throwBox("a")).toBe(true);
    const box = sim.boxes.get(c.id)!;
    expect(box.state).toBe("flying");
    expect(box.z).toBeLessThan(5);
    expect(box.z).toBeGreaterThan(2.5);
    expect(sim.pickup("b", c.id)).toBe(false);
    run(sim, 0.6);
    expect(box.state).toBe("available");
  });

  it("puts a crate on the belt, and the belt delivers it to the racks", () => {
    const { sim } = setup();
    const c = crates(sim)[0];
    place(sim, "a", c.x, c.z + 0.8);
    sim.pickup("a", c.id);
    place(sim, "a", -3, -3.2);
    expect(resolveInteraction(sim, sim.players.get("a")!)!.label).toMatch(/belt/);
    expect(sim.put("a")).toBe(true);
    expect(sim.boxes.get(c.id)!.state).toBe("onConveyor");
    run(sim, 8);
    expect(sim.boxes.get(c.id)!.state).toBe("available");
    expect(sim.boxes.get(c.id)!.x).toBeGreaterThan(6.5);
  });
});

describe("player collision", () => {
  it("separates overlapping workers", () => {
    const { sim } = setup();
    place(sim, "a", 0, 6);
    place(sim, "b", 0.2, 6);
    run(sim, 0.5);
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.89);
    expect(isWalkable(a.x, a.z) && isWalkable(b.x, b.z)).toBe(true);
  });

  it("nudges a bystander more than the mover when walking into them", () => {
    const { sim } = setup();
    place(sim, "a", 0, 6);
    place(sim, "b", 1.0, 6);
    expect(sim.move("a", 0.4, 6, 0, 1000)).toBe(true);
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    expect(b.x).toBeGreaterThan(1.0); // pushed along
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.89);
    expect(a.x).toBeLessThan(0.4); // mover gave a little ground
    expect(a.x).toBeGreaterThan(0.1);
  });

  it("does not push a bystander through a wall", () => {
    const { sim } = setup();
    place(sim, "b", 11.5, -1);
    place(sim, "a", 10.7, -1);
    sim.move("a", 11.0, -1, 0, 1000);
    const b = sim.players.get("b")!;
    expect(isWalkable(b.x, b.z)).toBe(true);
    const a = sim.players.get("a")!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.89);
  });
});

describe("hold-to-act tasks", () => {
  it("unpacks a crate into the rack only after the full hold", () => {
    const { sim } = setup();
    carryCrateToRack(sim);
    const before = sim.fixtures.get("rackA")!.stock;
    const i = sim.startHold("a")!;
    expect(i.kind).toBe("unpack");
    run(sim, HOLD.unpack - 0.5);
    expect(sim.fixtures.get("rackA")!.stock).toBe(before);
    expect(sim.players.get("a")!.actionProgress).toBeGreaterThan(0.5);
    run(sim, 0.7);
    expect(sim.fixtures.get("rackA")!.stock).toBe(before + ECON.crateUnits);
    expect(sim.players.get("a")!.heldBoxId).toBe("");
  });

  it("cancels when released or when the worker walks away", () => {
    const { sim } = setup();
    carryCrateToRack(sim);
    sim.startHold("a");
    run(sim, 1);
    sim.stopHold("a");
    expect(sim.players.get("a")!.actionProgress).toBe(0);
    sim.startHold("a");
    run(sim, 1);
    place(sim, "a", 0, 5);
    run(sim, 0.1);
    expect(sim.players.get("a")!.action).toBe("");
    run(sim, 5);
    expect(sim.fixtures.get("rackA")!.stock).toBe(24);
  });

  it("moves goods rack -> tray -> shelf, with the hands upgrade shortening holds", () => {
    const { sim } = setup();
    place(sim, "a", 9.5, -6.0);
    expect(sim.startHold("a")!.kind).toBe("take");
    run(sim, HOLD.take + 0.2);
    const tray = sim.boxes.get(sim.players.get("a")!.heldBoxId)!;
    expect(tray.type).toBe("goods");
    expect(sim.fixtures.get("rackA")!.stock).toBe(24 - ECON.trayUnits);
    place(sim, "a", 7, 4.0, Math.PI);
    place(sim, "a", 7, 3.8);
    const i = resolveInteraction(sim, sim.players.get("a")!)!;
    expect(i.kind).toBe("stock");
    expect(i.duration).toBe(HOLD.stock);
    sim.money = 1000;
    sim.buyUpgrade("a", "hands");
    expect(resolveInteraction(sim, sim.players.get("a")!)!.duration).toBeCloseTo(HOLD.stock * 0.8);
    sim.startHold("a");
    run(sim, HOLD.stock * 0.8 + 0.2);
    expect(sim.fixtures.get("shelfB")!.stock).toBe(ECON.trayUnits);
    expect(sim.boxes.has(tray.id)).toBe(false);
  });

  it("does not let two workers take the same stock twice", () => {
    const { sim } = setup();
    sim.fixtures.get("rackA")!.stock = ECON.trayUnits;
    place(sim, "a", 9.5, -6.0);
    place(sim, "b", 10.5, -6.0);
    sim.startHold("a");
    sim.startHold("b");
    run(sim, HOLD.take + 0.2);
    const holding = [...sim.players.values()].filter((p) => p.heldBoxId).length;
    expect(holding).toBe(1);
    expect(sim.fixtures.get("rackA")!.stock).toBe(0);
  });

  it("only offers a hold the worker can actually do", () => {
    const { sim } = setup();
    expect(sim.startHold("a")).toBeNull();
    place(sim, "a", 9.5, -6.0);
    sim.fixtures.get("rackA")!.stock = 0;
    expect(sim.startHold("a")).toBeNull();
  });
});

describe("wholesaler van", () => {
  it("costs money, takes the driver away, then brings crates down the belt", () => {
    const { sim } = setup();
    place(sim, "a", -7, -3);
    const i = sim.startHold("a")!;
    expect(i.kind).toBe("drive");
    run(sim, HOLD.drive + 0.2);
    expect(sim.money).toBe(ECON.startMoney - ECON.vanCost);
    expect(sim.players.get("a")!.away).toBe(true);
    expect(sim.van.state).toBe("away");
    expect(sim.move("a", -7, -3.1, 0, 5000)).toBe(false);
    const crateCount = crates(sim).length;
    run(sim, TIMING.vanTrip + 0.5);
    expect(sim.players.get("a")!.away).toBe(false);
    run(sim, 8);
    expect(crates(sim).length).toBe(crateCount + ECON.vanCrates);
  });

  it("refuses when there is not enough money", () => {
    const { sim } = setup();
    sim.money = 10;
    place(sim, "a", -7, -3);
    expect(sim.startHold("a")).toBeNull();
    expect(resolveInteraction(sim, sim.players.get("a")!)!.kind).toBe("info");
  });
});

describe("day cycle and customers", () => {
  it("runs prep -> open -> closing -> summary -> next day", () => {
    const { sim, events } = setup();
    run(sim, TIMING.prep + 16);
    expect(sim.phase).toBe("open");
    run(sim, TIMING.open + 0.5);
    expect(sim.phase).toBe("closing");
    for (let t = 0; t < TIMING.closingMax + 5 && sim.phase === "closing"; t += 0.05) sim.tick(0.05);
    expect(sim.phase).toBe("summary");
    run(sim, TIMING.summary + 0.5);
    expect(sim.day).toBe(2);
    expect(sim.phase).toBe("prep");
    expect(events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase)).toEqual(["open", "closing", "summary", "prep"]);
  });

  it("can be opened early at the door", () => {
    const { sim } = setup();
    place(sim, "a", -1.5, 6.9);
    expect(sim.startHold("a")!.kind).toBe("open");
    run(sim, HOLD.open + 0.2);
    expect(sim.phase).toBe("open");
  });

  it("sells stocked goods once the cashier scans, exactly once per customer", () => {
    const { sim, events } = setup();
    stockShelf(sim, "shelfA", 18);
    stockShelf(sim, "shelfB", 18);
    stockShelf(sim, "shelfC", 18);
    stockShelf(sim, "shelfD", 18);
    openStore(sim);
    place(sim, "a", (CASHIER_ZONE.minX + CASHIER_ZONE.maxX) / 2, 7.1);
    for (let t = 0; t < 80; t += 0.05) {
      sim.tick(0.05);
      sim.startHold("a"); // the cashier keeps working whenever a customer is ready
    }
    const saleEvents = events.filter((e) => e.type === "sale");
    expect(saleEvents.length).toBeGreaterThan(2);
    expect(sim.stats.served).toBe(saleEvents.length);
    expect(sim.stats.earned).toBe(sim.money - ECON.startMoney);
    expect(sim.stats.earned % ECON.price).toBe(0);
    // shelf stock went down by exactly the units sold
    const left = [...sim.fixtures.values()].filter((f) => f.id.startsWith("shelf")).reduce((s, f) => s + f.stock, 0);
    const inBaskets = [...sim.customers.values()].reduce((s, c) => s + c.items, 0);
    expect(72 - left - inBaskets).toBe(sim.stats.earned / ECON.price);
  });

  it("loses customers when shelves are empty", () => {
    const { sim, events } = setup();
    openStore(sim);
    run(sim, 40);
    expect(sim.stats.lost).toBeGreaterThan(0);
    expect(sim.stats.served).toBe(0);
    expect(events.some((e) => e.type === "lost")).toBe(true);
    expect(sim.money).toBe(ECON.startMoney);
  });

  it("loses queued customers who wait too long for a cashier", () => {
    const { sim } = setup();
    for (const s of ["shelfA", "shelfB", "shelfC", "shelfD"]) stockShelf(sim, s, 18);
    openStore(sim);
    run(sim, 90);
    expect(sim.stats.lost).toBeGreaterThan(0);
    expect(sim.stats.served).toBe(0);
    expect([...sim.customers.values()].filter((c) => c.slot >= 0).length).toBeLessThanOrEqual(QUEUE_SLOTS.length);
  });

  it("buys upgrades only with enough money and up to the max level", () => {
    const { sim } = setup();
    sim.money = 50;
    expect(sim.buyUpgrade("a", "deal")).toBe(false);
    sim.money = 10_000;
    for (let i = 0; i < 5; i++) sim.buyUpgrade("a", "traffic");
    expect(sim.upgrades.traffic).toBe(3);
    expect(sim.buyUpgrade("a", "nonsense")).toBe(false);
  });
});
