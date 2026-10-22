import { describe, expect, it } from "vitest";
import { CONVEYOR, CONVEYOR_LENGTH, DELIVERY_TARGET, MAX_PLAYERS, ORDER_ZONE } from "./constants";
import { isWalkable, resolveMove } from "./geometry";
import { GameSim } from "./sim";

function setup() {
  const sim = new GameSim();
  const a = sim.addPlayer("a", "A")!;
  const b = sim.addPlayer("b", "B")!;
  return { sim, a, b };
}
function teleportNextTo(sim: GameSim, pid: string, boxId: string) {
  const p = sim.players.get(pid)!;
  const bx = sim.boxes.get(boxId)!;
  p.x = bx.x;
  p.z = bx.z + 0.8;
}

describe("GameSim", () => {
  it("caps players at five", () => {
    const sim = new GameSim();
    for (let i = 0; i < MAX_PLAYERS; i++) expect(sim.addPlayer(`p${i}`, "x")).not.toBeNull();
    expect(sim.addPlayer("extra", "x")).toBeNull();
  });

  it("lets only one of two players pick up the same box", () => {
    const { sim } = setup();
    const id = [...sim.boxes.keys()][0];
    teleportNextTo(sim, "a", id);
    teleportNextTo(sim, "b", id);
    expect(sim.pickup("a", id)).toBe(true);
    expect(sim.pickup("b", id)).toBe(false);
    expect(sim.boxes.get(id)!.heldBy).toBe("a");
  });

  it("rejects pickup out of range and double carrying", () => {
    const { sim } = setup();
    const [first, second] = [...sim.boxes.keys()];
    expect(sim.pickup("a", first)).toBe(false); // spawn is far from boxes
    teleportNextTo(sim, "a", first);
    expect(sim.pickup("a", first)).toBe(true);
    teleportNextTo(sim, "a", second);
    expect(sim.pickup("a", second)).toBe(false);
  });

  it("delivers exactly once per box via the order zone", () => {
    const { sim } = setup();
    const id = [...sim.boxes.keys()][0];
    teleportNextTo(sim, "a", id);
    sim.pickup("a", id);
    const p = sim.players.get("a")!;
    p.x = (ORDER_ZONE.minX + ORDER_ZONE.maxX) / 2;
    p.z = -6;
    expect(sim.put("a", false)).toBe(true);
    expect(sim.delivered).toBe(1);
    expect(sim.put("a", false)).toBe(false);
    sim.tick(0.05, 100);
    expect(sim.delivered).toBe(1);
    expect(sim.pickup("b", id)).toBe(false); // delivered boxes cannot be picked up
  });

  it("moves a belt box to the end and delivers it once", () => {
    const { sim } = setup();
    const id = [...sim.boxes.keys()][0];
    teleportNextTo(sim, "a", id);
    sim.pickup("a", id);
    const p = sim.players.get("a")!;
    p.x = CONVEYOR.start.x;
    p.z = CONVEYOR.start.z + 1.7;
    p.rot = Math.PI;
    expect(sim.put("a", false)).toBe(true);
    expect(sim.boxes.get(id)!.state).toBe("onConveyor");
    let t = 0;
    const steps = Math.ceil((CONVEYOR_LENGTH / CONVEYOR.speed) * 20) + 5;
    for (let i = 0; i < steps; i++) sim.tick(0.05, (t += 50));
    expect(sim.delivered).toBe(1);
    for (let i = 0; i < 100; i++) sim.tick(0.05, (t += 50));
    expect(sim.delivered).toBe(1);
    expect(sim.boxes.has(id)).toBe(false); // removed after linger
  });

  it("completes at the target, then resets", () => {
    const { sim } = setup();
    let now = 0;
    for (let n = 0; n < DELIVERY_TARGET; n++) {
      const id = [...sim.boxes.values()].find((b) => b.state === "available")!.id;
      teleportNextTo(sim, "a", id);
      sim.pickup("a", id);
      const p = sim.players.get("a")!;
      p.x = 9;
      p.z = -5;
      sim.put("a", true);
      sim.tick(0.05, (now += 50));
    }
    expect(sim.phase).toBe("complete");
    sim.tick(0.05, now + 10_000);
    expect(sim.phase).toBe("playing");
    expect(sim.delivered).toBe(0);
  });

  it("releases a held box when its player disconnects", () => {
    const { sim } = setup();
    const id = [...sim.boxes.keys()][0];
    teleportNextTo(sim, "a", id);
    sim.pickup("a", id);
    sim.removePlayer("a");
    const box = sim.boxes.get(id)!;
    expect(box.state).toBe("available");
    teleportNextTo(sim, "b", id);
    expect(sim.pickup("b", id)).toBe(true);
  });

  it("rejects teleporting, out-of-bounds and inside-shelf moves", () => {
    const { sim, a } = setup();
    expect(sim.move("a", a.x + 0.1, a.z, 0, 1000)).toBe(true);
    expect(sim.move("a", a.x + 8, a.z, 0, 1050)).toBe(false);
    expect(sim.move("a", 100, 100, 0, 1100)).toBe(false);
    expect(sim.move("a", Number.NaN, 0, 0, 1150)).toBe(false);
    expect(isWalkable(1, 2.5)).toBe(false); // island shelf
  });

  it("slides along obstacles instead of passing through", () => {
    const r = resolveMove(1, 1.4, 1, 2.2);
    expect(isWalkable(r.x, r.z)).toBe(true);
    expect(r.z).toBeLessThan(2);
  });
});
