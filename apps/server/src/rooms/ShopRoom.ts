import { Room, type Client } from "@colyseus/core";
import {
  GameSim,
  MAX_PLAYERS,
  MIN_ACTION_INTERVAL_MS,
  MIN_HOLD_INTERVAL_MS,
  MIN_MOVE_INTERVAL_MS,
  MSG,
  SERVER_TICK_HZ,
  type HoldMessage,
  type MoveMessage,
  type PickupMessage,
  type UpgradeMessage,
} from "@shop/shared";
import { BoxSchema, CustomerSchema, FixtureSchema, PlayerSchema, ShopState } from "../state/schema";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
type Kind = "move" | "action" | "hold";

/** Room wrapper: validates client intents, runs the shared GameSim, mirrors it into the synced schema. */
export class ShopRoom extends Room<{ state: ShopState }> {
  maxClients = MAX_PLAYERS;
  state = new ShopState();

  private sim = new GameSim();
  private lastMsgAt = new Map<string, Record<Kind, number>>();
  private joined = 0;

  onCreate() {
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
    this.onMessage(MSG.put, (client) => {
      if (!this.allow(client, "action", MIN_ACTION_INTERVAL_MS)) return;
      if (this.sim.put(client.sessionId)) this.syncState();
    });
    this.onMessage(MSG.throw, (client) => {
      if (!this.allow(client, "action", MIN_ACTION_INTERVAL_MS)) return;
      if (this.sim.throwBox(client.sessionId)) this.syncState();
    });
    this.onMessage(MSG.hold, (client, msg: HoldMessage) => {
      if (!this.allow(client, "hold", MIN_HOLD_INTERVAL_MS)) return;
      if (msg?.on === true) this.sim.startHold(client.sessionId);
      else this.sim.stopHold(client.sessionId);
      this.syncState();
    });
    this.onMessage(MSG.upgrade, (client, msg: UpgradeMessage) => {
      if (!this.allow(client, "action", MIN_ACTION_INTERVAL_MS)) return;
      if (!msg || typeof msg.id !== "string" || msg.id.length > 16) return;
      this.sim.buyUpgrade(client.sessionId, msg.id);
    });

    this.setSimulationInterval((dtMs) => {
      this.sim.tick(Math.min(dtMs, 250) / 1000);
      this.syncState();
    }, 1000 / SERVER_TICK_HZ);
  }

  onJoin(client: Client, options?: { name?: string }) {
    const name = String(options?.name ?? "").replace(/[^\w -]/g, "").slice(0, 14) || `Worker ${++this.joined}`;
    this.lastMsgAt.set(client.sessionId, { move: 0, action: 0, hold: 0 });
    if (!this.sim.addPlayer(client.sessionId, name)) client.leave();
    this.syncState();
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.lastMsgAt.delete(client.sessionId);
    this.syncState();
  }

  private allow(client: Client, kind: Kind, minMs: number): boolean {
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
    const m = this.sim;
    const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K]) => {
      if (o[k] !== v) o[k] = v;
    };
    set(s, "money", m.money);
    set(s, "day", m.day);
    set(s, "phase", m.phase);
    set(s, "phaseLeft", Math.round(m.phaseLeft * 10) / 10);
    set(s, "clock", Math.round(m.clock));
    set(s, "vanState", m.van.state);
    set(s, "vanDriver", m.van.driver);
    set(s, "vanLeft", Math.round(m.van.left * 10) / 10);
    set(s, "hands", m.upgrades.hands);
    set(s, "deal", m.upgrades.deal);
    set(s, "traffic", m.upgrades.traffic);
    set(s, "earned", m.stats.earned);
    set(s, "served", m.stats.served);
    set(s, "lost", m.stats.lost);

    for (const f of m.fixtures.values()) {
      let sf = s.fixtures.get(f.id);
      if (!sf) {
        sf = new FixtureSchema();
        sf.id = f.id;
        s.fixtures.set(f.id, sf);
      }
      set(sf, "stock", f.stock);
    }

    for (const id of [...s.players.keys()]) if (!m.players.has(id)) s.players.delete(id);
    for (const p of m.players.values()) {
      let sp = s.players.get(p.id);
      if (!sp) {
        sp = new PlayerSchema();
        sp.id = p.id;
        sp.name = p.name;
        sp.colorIndex = p.colorIndex;
        s.players.set(p.id, sp);
      }
      set(sp, "x", p.x);
      set(sp, "z", p.z);
      set(sp, "rot", p.rot);
      set(sp, "heldBoxId", p.heldBoxId);
      set(sp, "action", p.action);
      set(sp, "actionProgress", Math.round(p.actionProgress * 100) / 100);
      set(sp, "away", p.away);
    }

    for (const id of [...s.boxes.keys()]) if (!m.boxes.has(id)) s.boxes.delete(id);
    for (const b of m.boxes.values()) {
      let sb = s.boxes.get(b.id);
      if (!sb) {
        sb = new BoxSchema();
        sb.id = b.id;
        sb.type = b.type;
        sb.units = b.units;
        s.boxes.set(b.id, sb);
      }
      set(sb, "x", b.x);
      set(sb, "z", b.z);
      set(sb, "state", b.state);
      set(sb, "heldBy", b.heldBy);
      set(sb, "progress", b.progress);
      set(sb, "units", b.units);
    }

    for (const id of [...s.customers.keys()]) if (!m.customers.has(id)) s.customers.delete(id);
    for (const c of m.customers.values()) {
      let sc = s.customers.get(c.id);
      if (!sc) {
        sc = new CustomerSchema();
        sc.id = c.id;
        sc.skin = c.skin;
        s.customers.set(c.id, sc);
      }
      set(sc, "x", Math.round(c.x * 100) / 100);
      set(sc, "z", Math.round(c.z * 100) / 100);
      set(sc, "rot", Math.round(c.rot * 100) / 100);
      set(sc, "state", c.state);
      set(sc, "items", c.items);
      set(sc, "patience", Math.round(c.patience * 20) / 20);
      set(sc, "slot", c.slot);
    }
  }
}
