import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { MINIGAME_CONFIG, MSG, ROOM_NAME, generateItems, type MinigameResult, type MinigameStartResult } from "@shop/shared";
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
  it("issues a session, rejects a premature/forged report and rewards an honest one once", async () => {
    const a = await join("Mini");
    const sessionMsg = once<MinigameStartResult>(a, MSG.mgSession);
    a.send(MSG.mgStart, { kind: "checkout" });
    const started = await sessionMsg;
    if (!started.ok) throw new Error(started.reason);
    const s = started.session;
    const items = generateItems(s.seed, s.count);
    const report = { sessionId: s.id, kind: s.kind, items, actions: s.count, clientDurationMs: 60_000 };

    // Instant report: the server's own clock says it was too fast (and consumes the session).
    await sleep(150); // the room rate-limits actions to one per MIN_ACTION_INTERVAL_MS
    const early = once<MinigameResult>(a, MSG.mgResult);
    a.send(MSG.mgComplete, report);
    expect(await early).toMatchObject({ ok: false, reason: "too_fast", reward: 0 });

    // Malformed payload is refused.
    await sleep(150);
    const bad = once<MinigameResult>(a, MSG.mgResult);
    a.send(MSG.mgComplete, { sessionId: 5 });
    expect(await bad).toMatchObject({ ok: false, reason: "bad_request" });

    // A fresh honest run after the minimum time is accepted exactly once.
    await sleep(MINIGAME_CONFIG.checkout.minBaseMs);
    const s2msg = once<MinigameStartResult>(a, MSG.mgSession);
    a.send(MSG.mgStart, { kind: "checkout" });
    const second = await s2msg;
    if (!second.ok) throw new Error(second.reason);
    const s2 = second.session;
    await sleep(MINIGAME_CONFIG.checkout.minBaseMs + s2.count * MINIGAME_CONFIG.checkout.minMsPerItem + 100);
    const rep2 = { sessionId: s2.id, kind: s2.kind, items: generateItems(s2.seed, s2.count), actions: s2.count, clientDurationMs: 1 };
    const ok = once<MinigameResult>(a, MSG.mgResult);
    a.send(MSG.mgComplete, rep2);
    expect(await ok).toMatchObject({ ok: true, reward: s2.count * MINIGAME_CONFIG.checkout.rewardPerItem });
    await sleep(150);
    const dup = once<MinigameResult>(a, MSG.mgResult);
    a.send(MSG.mgComplete, rep2);
    expect(await dup).toMatchObject({ ok: false, reason: "no_session" });
  }, 20_000);
});
