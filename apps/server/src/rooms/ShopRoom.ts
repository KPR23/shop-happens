import { Room, type Client } from "@colyseus/core";
import {
  GameSim,
  MAX_PLAYERS,
  MIN_ACTION_INTERVAL_MS,
  MIN_MOVE_INTERVAL_MS,
  MSG,
  SERVER_TICK_HZ,
  type MoveMessage,
  type PickupMessage,
  type PutMessage,
} from "@shop/shared";
import { BoxSchema, PlayerSchema, ShopState } from "../state/schema";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Room wrapper: validates client intents, runs the shared GameSim, mirrors it into the synced schema. */
export class ShopRoom extends Room<{ state: ShopState }> {
  maxClients = MAX_PLAYERS;
  state = new ShopState();

  private sim = new GameSim();
  private lastMsgAt = new Map<string, { move: number; action: number }>();
  private joined = 0;

  onCreate() {
    this.state.target = this.sim.target;
    this.state.phase = this.sim.phase;
    this.sim.onEvent = (e) => this.broadcast(MSG.event, e);
    this.syncState();

    this.onMessage(MSG.move, (client, msg: MoveMessage) => {
      if (!this.allow(client, "move", MIN_MOVE_INTERVAL_MS)) return;
      if (!msg || !isNum(msg.x) || !isNum(msg.z) || !isNum(msg.rot)) return;
      this.sim.move(client.sessionId, msg.x, msg.z, msg.rot, Date.now());
    });
    this.onMessage(MSG.pickup, (client, msg: PickupMessage) => {
      if (!this.allow(client, "action", MIN_ACTION_INTERVAL_MS)) return;
      if (!msg || typeof msg.boxId !== "string" || msg.boxId.length > 32) return;
      if (this.sim.pickup(client.sessionId, msg.boxId)) this.syncState();
    });
    this.onMessage(MSG.put, (client, msg: PutMessage) => {
      if (!this.allow(client, "action", MIN_ACTION_INTERVAL_MS)) return;
      if (this.sim.put(client.sessionId, !!msg?.drop)) this.syncState();
    });

    this.setSimulationInterval((dtMs) => {
      this.sim.tick(dtMs / 1000, Date.now());
      this.syncState();
    }, 1000 / SERVER_TICK_HZ);
  }

  onJoin(client: Client, options?: { name?: string }) {
    const name = String(options?.name ?? "").replace(/[^\w -]/g, "").slice(0, 14) || `Worker ${++this.joined}`;
    this.lastMsgAt.set(client.sessionId, { move: 0, action: 0 });
    if (!this.sim.addPlayer(client.sessionId, name)) client.leave();
    this.syncState();
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.lastMsgAt.delete(client.sessionId);
    this.syncState();
  }

  private allow(client: Client, kind: "move" | "action", minMs: number): boolean {
    const rec = this.lastMsgAt.get(client.sessionId);
    if (!rec) return false;
    const now = Date.now();
    if (now - rec[kind] < minMs) return false;
    rec[kind] = now;
    return true;
  }

  /** Copy sim -> schema, writing only on change so patches stay small. */
  private syncState() {
    const s = this.state;
    if (s.delivered !== this.sim.delivered) s.delivered = this.sim.delivered;
    if (s.phase !== this.sim.phase) s.phase = this.sim.phase;

    for (const id of [...s.players.keys()]) if (!this.sim.players.has(id)) s.players.delete(id);
    for (const p of this.sim.players.values()) {
      let sp = s.players.get(p.id);
      if (!sp) {
        sp = new PlayerSchema();
        sp.id = p.id;
        sp.name = p.name;
        sp.colorIndex = p.colorIndex;
        s.players.set(p.id, sp);
      }
      if (sp.x !== p.x) sp.x = p.x;
      if (sp.z !== p.z) sp.z = p.z;
      if (sp.rot !== p.rot) sp.rot = p.rot;
      if (sp.heldBoxId !== p.heldBoxId) sp.heldBoxId = p.heldBoxId;
    }

    for (const id of [...s.boxes.keys()]) if (!this.sim.boxes.has(id)) s.boxes.delete(id);
    for (const b of this.sim.boxes.values()) {
      let sb = s.boxes.get(b.id);
      if (!sb) {
        sb = new BoxSchema();
        sb.id = b.id;
        sb.kind = b.kind;
        s.boxes.set(b.id, sb);
      }
      if (sb.x !== b.x) sb.x = b.x;
      if (sb.z !== b.z) sb.z = b.z;
      if (sb.state !== b.state) sb.state = b.state;
      if (sb.heldBy !== b.heldBy) sb.heldBy = b.heldBy;
      if (sb.progress !== b.progress) sb.progress = b.progress;
    }
  }
}
