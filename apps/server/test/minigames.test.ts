import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { MSG, ROOM_NAME, generateItems, type MinigameResult, type MinigameStartResult } from "@shop/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShopRoom } from "../src/rooms/ShopRoom";

const PORT = 2598;
let server: Server;
const rooms: Room[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(name: string): Promise<Room> {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name });
  room.onMessage(MSG.event, () => {});
  rooms.push(room);
  return room;
}
const once = <T>(room: Room, type: string) => new Promise<T>((res) => room.onMessage(type, (m: T) => res(m)));

beforeAll(async () => {
  server = new Server({ transport: new WebSocketTransport(), greet: false });
  server.define(ROOM_NAME, ShopRoom);
  await server.listen(PORT);
});
afterAll(async () => {
  await Promise.race([Promise.all(rooms.map((r) => r.leave().catch(() => {}))), sleep(3000)]);
  await Promise.race([server.gracefullyShutdown(false).catch(() => {}), sleep(3000)]);
});

describe("minigame messages", () => {
  it("refuses a session away from a station and malformed reports", async () => {
    const a = await join("Mini");
    const sessionMsg = once<MinigameStartResult>(a, MSG.mgSession);
    a.send(MSG.mgStart, { kind: "checkout" });
    expect(await sessionMsg).toMatchObject({ ok: false, reason: "no_station" });

    await sleep(150); // the room rate-limits actions to one per MIN_ACTION_INTERVAL_MS
    const bad = once<MinigameResult>(a, MSG.mgResult);
    a.send(MSG.mgComplete, { sessionId: 5 });
    expect(await bad).toMatchObject({ ok: false, reason: "bad_request" });

    await sleep(150);
    const forged = once<MinigameResult>(a, MSG.mgResult);
    const items = generateItems(1, 4);
    a.send(MSG.mgComplete, { sessionId: "mg-1-x", kind: "checkout", items, actions: items.length, clientDurationMs: 60_000 });
    expect(await forged).toMatchObject({ ok: false, reason: "no_session", reward: 0 });
  }, 20_000);
});
