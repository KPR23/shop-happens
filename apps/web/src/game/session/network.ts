import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  ROOM_NAME,
  type ActionKind,
  type BoxData,
  type BoxState,
  type BoxType,
  type CustomerData,
  type CustomerState,
  type DayPhase,
  type DayStats,
  type FixtureData,
  type PlayerData,
  type SimEvent,
  type Upgrades,
  type VanData,
  type WorldView,
} from "@shop/shared";
import type { Session } from "./types";

class NetView implements WorldView {
  players = new Map<string, PlayerData>();
  boxes = new Map<string, BoxData>();
  fixtures = new Map<string, FixtureData>();
  customers = new Map<string, CustomerData>();
  money = 0;
  day = 1;
  phase: DayPhase = "prep";
  phaseLeft = 0;
  clock = 420;
  van: VanData = { state: "idle", driver: "", left: 0 };
  upgrades: Upgrades = { hands: 0, deal: 0, traffic: 0 };
  stats: DayStats = { earned: 0, served: 0, lost: 0 };
}

/** Colyseus-backed session. The room state is mirrored into plain maps on every patch. */
export class NetworkSession implements Session {
  readonly view = new NetView();
  onEvent?: (e: SimEvent) => void;
  onDisconnect?: (reason: string) => void;

  private constructor(private room: Room) {
    room.onStateChange((state: any) => this.mirror(state));
    room.onMessage(MSG.event, (e: SimEvent) => this.onEvent?.(e));
    room.onLeave((code: number) => this.onDisconnect?.(`Disconnected (code ${code})`));
    room.onError((code: number, msg?: string) => this.onDisconnect?.(`Connection error ${code}${msg ? `: ${msg}` : ""}`));
    if (room.state) this.mirror(room.state);
  }

  static async connect(url: string, name: string, timeoutMs = 5000): Promise<NetworkSession> {
    const client = new Client(url);
    const room = await Promise.race([
      client.joinOrCreate(ROOM_NAME, { name }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`No response from ${url}`)), timeoutMs)),
    ]);
    return new NetworkSession(room);
  }

  get localId() {
    return this.room.sessionId;
  }

  private mirror(s: any) {
    if (!s?.players || !s?.boxes || !s?.fixtures || !s?.customers) return; // first patch not decoded yet
    const v = this.view;
    v.money = s.money;
    v.day = s.day;
    v.phase = s.phase as DayPhase;
    v.phaseLeft = s.phaseLeft;
    v.clock = s.clock;
    v.van = { state: s.vanState, driver: s.vanDriver, left: s.vanLeft };
    v.upgrades = { hands: s.hands, deal: s.deal, traffic: s.traffic };
    v.stats = { earned: s.earned, served: s.served, lost: s.lost };
    v.players.clear();
    s.players.forEach((p: any, id: string) =>
      v.players.set(id, {
        id,
        name: p.name,
        colorIndex: p.colorIndex,
        x: p.x,
        z: p.z,
        rot: p.rot,
        heldBoxId: p.heldBoxId,
        action: p.action as ActionKind,
        actionProgress: p.actionProgress,
        away: p.away,
      }),
    );
    v.boxes.clear();
    s.boxes.forEach((b: any, id: string) =>
      v.boxes.set(id, { id, x: b.x, z: b.z, state: b.state as BoxState, heldBy: b.heldBy, progress: b.progress, type: b.type as BoxType, units: b.units }),
    );
    v.fixtures.clear();
    s.fixtures.forEach((f: any, id: string) => v.fixtures.set(id, { id, stock: f.stock }));
    v.customers.clear();
    s.customers.forEach((c: any, id: string) =>
      v.customers.set(id, { id, x: c.x, z: c.z, rot: c.rot, state: c.state as CustomerState, items: c.items, patience: c.patience, skin: c.skin, slot: c.slot }),
    );
  }

  sendMove(x: number, z: number, rot: number) {
    this.room.send(MSG.move, { x, z, rot });
  }
  pickup(boxId: string) {
    this.room.send(MSG.pickup, { boxId });
  }
  put() {
    this.room.send(MSG.put);
  }
  throwBox() {
    this.room.send(MSG.throw);
  }
  hold(on: boolean) {
    this.room.send(MSG.hold, { on });
  }
  upgrade(id: string) {
    this.room.send(MSG.upgrade, { id });
  }
  update() {}
  dispose() {
    this.onDisconnect = undefined;
    void this.room.leave().catch(() => {});
  }
}
