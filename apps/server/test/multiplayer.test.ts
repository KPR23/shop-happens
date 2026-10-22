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
  it("shares a room, state, exclusive pickup, delivery, capacity and disconnect release", async () => {
    const a = await join("Ann");
    const b = await join("Bob");
    const c = await join("Cy");
    expect(b.roomId).toBe(a.roomId);
    await waitFor(() => a.state.players.size === 3 && c.state.players.size === 3);
    expect(a.state.boxes.size).toBeGreaterThanOrEqual(6);

    // Two clients walk next to the same box and request pickup in the same instant.
    const target = [...a.state.boxes.values()].find((bx: any) => bx.x === -6.5 && bx.z === 3.5) as any;
    await Promise.all([walk(a, [[-2, 5], [-6.5, 5], [-6.5, 4.3]]), walk(b, [[1, 5], [-6.5, 5.2], [-6.4, 4.4]])]);
    await sleep(150);
    a.send(MSG.pickup, { boxId: target.id });
    b.send(MSG.pickup, { boxId: target.id });
    await waitFor(() => c.state.boxes.get(target.id)?.state === "held");
    await sleep(200);
    const holder = c.state.boxes.get(target.id).heldBy;
    expect([a.sessionId, b.sessionId]).toContain(holder);
    const holders = [...c.state.players.values()].filter((p: any) => p.heldBoxId === target.id);
    expect(holders).toHaveLength(1);

    // The winner carries it to the order zone; delivery counts exactly once on every client.
    const winner = holder === a.sessionId ? a : b;
    await walk(winner, [[-6.5, 5], [4, 5], [4, 0], [8, 0], [8, -5]]);
    await sleep(150);
    winner.send(MSG.put, { drop: false });
    winner.send(MSG.put, { drop: false }); // repeated trigger must not double-count
    await waitFor(() => a.state.delivered === 1 && c.state.delivered === 1);
    await sleep(300);
    expect(c.state.delivered).toBe(1);

    // Capacity: five players fit, a sixth is refused.
    const extra = [await join("D"), await join("E")];
    expect(extra).toHaveLength(2);
    await waitFor(() => a.state.players.size === MAX_PLAYERS);
    const overflow = await join("F"); // joinOrCreate opens a fresh room when the first is full
    expect(overflow.roomId).not.toBe(a.roomId);

    // Disconnecting a carrier releases the box.
    const loser = winner === a ? b : a;
    const box2 = [...c.state.boxes.values()].find((bx: any) => bx.state === "available" && bx.x === -9.5 && bx.z === 3.5) as any;
    await walk(loser, [[-6.5, 5], [-9.5, 5], [-9.5, 4.3]]);
    await sleep(150);
    loser.send(MSG.pickup, { boxId: box2.id });
    await waitFor(() => c.state.boxes.get(box2.id)?.heldBy === loser.sessionId);
    await loser.leave();
    await waitFor(() => c.state.boxes.get(box2.id)?.state === "available");
    expect(c.state.boxes.get(box2.id).heldBy).toBe("");
  }, 40_000);

  it("ignores teleporting movement", async () => {
    const d = await join("Tele");
    await waitFor(() => !!d.state?.players?.get(d.sessionId));
    const before = d.state.players.get(d.sessionId).x;
    d.send(MSG.move, { x: before + 9, z: 5.5, rot: 0 });
    await sleep(250);
    expect(d.state.players.get(d.sessionId).x).toBeCloseTo(before, 1);
  });
});
