import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_PLAYERS, MSG, ROOM_NAME } from "@shop/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShopRoom } from "../src/rooms/ShopRoom";

const PORT = 2599;
let server: Server;
const rooms: Room[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(name: string): Promise<Room> {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name });
  room.onMessage(MSG.event, () => {});
  rooms.push(room);
  return room;
}

async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await sleep(25);
  }
}

/** Walks in small steps, like the real client does at ~20Hz. */
async function walk(room: Room, path: Array<[number, number]>) {
  const me = room.state.players.get(room.sessionId);
  let x = me.x;
  let z = me.z;
  for (const [tx, tz] of path) {
    while (Math.hypot(tx - x, tz - z) > 0.01) {
      const d = Math.hypot(tx - x, tz - z);
      const step = Math.min(0.18, d);
      x += ((tx - x) / d) * step;
      z += ((tz - z) / d) * step;
      room.send(MSG.move, { x, z, rot: Math.atan2(tx - x, tz - z) });
      await sleep(40);
    }
  }
}

beforeAll(async () => {
  server = new Server({ transport: new WebSocketTransport(), greet: false });
  server.define(ROOM_NAME, ShopRoom);
  await server.listen(PORT);
});

afterAll(async () => {
  await Promise.race([Promise.all(rooms.map((r) => r.leave().catch(() => {}))), sleep(3000)]);
  await Promise.race([server.gracefullyShutdown(false).catch(() => {}), sleep(3000)]);
});

describe("multiplayer room", () => {
  it("shares state; exclusive pickup; hold tasks; stock chain; customers; upgrades; capacity; disconnect release", async () => {
    const a = await join("Ann");
    const b = await join("Bob");
    const c = await join("Cy");
    expect(b.roomId).toBe(a.roomId);
    await waitFor(() => a.state.players.size === 3 && c.state.players.size === 3);
    const crateIds = [...a.state.boxes.values()].filter((bx: any) => bx.type === "crate").map((bx: any) => bx.id);
    expect(crateIds.length).toBe(2);
    expect(a.state.fixtures.get("rackA").stock).toBe(24);

    // Two clients walk next to the same crate and request pickup at the same instant.
    const target = [...a.state.boxes.values()].find((bx: any) => Math.abs(bx.x - 8.3) < 0.01) as any;
    await Promise.all([
      walk(a, [[4, 5.5], [4, 0], [8.3, 0], [8.1, -2.9]]),
      walk(b, [[-3.5, 4.5], [4, 4.5], [4, 0], [8.3, 0], [8.7, -2.9]]),
    ]);
    await sleep(150);
    a.send(MSG.pickup, { boxId: target.id });
    b.send(MSG.pickup, { boxId: target.id });
    await waitFor(() => c.state.boxes.get(target.id)?.state === "held");
    await sleep(250);
    const holder = c.state.boxes.get(target.id).heldBy;
    expect([a.sessionId, b.sessionId]).toContain(holder);
    expect([...c.state.players.values()].filter((p: any) => p.heldBoxId === target.id)).toHaveLength(1);
    const winner = holder === a.sessionId ? a : b;
    const loser = winner === a ? b : a;

    // Hold-to-unpack at the rack: releasing early cancels, a full hold adds the crate's units.
    await walk(winner, [[9.5, -3], [9.5, -6]]);
    await sleep(200);
    winner.send(MSG.hold, { on: true });
    await waitFor(() => c.state.players.get(winner.sessionId).action === "unpack");
    await sleep(900);
    winner.send(MSG.hold, { on: false });
    await sleep(300);
    expect(c.state.players.get(winner.sessionId).action).toBe("");
    expect(c.state.fixtures.get("rackA").stock).toBe(24);
    await sleep(150);
    winner.send(MSG.hold, { on: true });
    await waitFor(() => c.state.fixtures.get("rackA").stock === 36, 6000);
    expect(c.state.players.get(winner.sessionId).heldBoxId).toBe("");

    // rack -> tray -> shelf
    await sleep(200);
    winner.send(MSG.hold, { on: true });
    await waitFor(() => !!c.state.players.get(winner.sessionId).heldBoxId, 5000);
    expect(c.state.fixtures.get("rackA").stock).toBe(30);
    await walk(winner, [[10, -3], [10, 4], [7, 3.9]]);
    await sleep(200);
    winner.send(MSG.hold, { on: true });
    await waitFor(() => c.state.fixtures.get("shelfB").stock === 6, 9000);

    // Open the store early at the door; a customer shows up on every client.
    await walk(loser, [[loser.state.players.get(loser.sessionId).x, 6.9], [-1.5, 6.9]]).catch(() => {});
    await sleep(200);
    loser.send(MSG.hold, { on: true });
    await waitFor(() => c.state.phase === "open", 5000);
    await waitFor(() => c.state.customers.size > 0, 15_000);
    expect(a.state.customers.size).toBeGreaterThan(0);

    // Upgrades are validated server-side and visible to everyone.
    const money = c.state.money;
    c.send(MSG.upgrade, { id: "hands" });
    await waitFor(() => a.state.hands === 1);
    expect(c.state.money).toBe(money - 80);
    c.send(MSG.upgrade, { id: "bogus" });
    await sleep(300);
    expect(c.state.money).toBe(money - 80);

    // Capacity: five players fit, a sixth gets a fresh room.
    const extra = [await join("D"), await join("E")];
    expect(extra).toHaveLength(2);
    await waitFor(() => a.state.players.size === MAX_PLAYERS);
    const overflow = await join("F");
    expect(overflow.roomId).not.toBe(a.roomId);

    // Disconnecting a carrier releases the crate.
    const crate2 = [...c.state.boxes.values()].find((bx: any) => bx.type === "crate" && bx.state === "available") as any;
    await walk(c, [[crate2.x + 0.5, 0], [crate2.x + 0.2, crate2.z + 0.9]]);
    await sleep(200);
    c.send(MSG.pickup, { boxId: crate2.id });
    await waitFor(() => a.state.boxes.get(crate2.id)?.heldBy === c.sessionId);
    await c.leave();
    await waitFor(() => a.state.boxes.get(crate2.id)?.state === "available");
    expect(a.state.boxes.get(crate2.id).heldBy).toBe("");
  }, 120_000);

  it("ignores teleporting movement", async () => {
    const d = await join("Tele");
    await waitFor(() => !!d.state?.players?.get(d.sessionId));
    const before = d.state.players.get(d.sessionId).x;
    d.send(MSG.move, { x: before + 9, z: 5.5, rot: 0 });
    await sleep(250);
    expect(d.state.players.get(d.sessionId).x).toBeCloseTo(before, 1);
  });

  it("workers collide: walking into someone nudges them instead of passing through", async () => {
    const a = await join("Pusher");
    const b = await join("Bystander");
    await waitFor(() => !!b.state?.players?.get(b.sessionId) && b.state.players.size >= 2);
    const bx0 = b.state.players.get(b.sessionId).x;
    const bz = b.state.players.get(b.sessionId).z;
    const me = a.state.players.get(a.sessionId);
    // walk from the left spawn straight into the other worker's spot
    await walk(a, [[me.x, bz], [bx0 + 0.3, bz]]);
    await sleep(400);
    const pa = b.state.players.get(a.sessionId);
    const pb = b.state.players.get(b.sessionId);
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThanOrEqual(0.85);
    expect(pb.x).toBeGreaterThan(bx0 + 0.05); // the bystander was shoved along
  });
});

