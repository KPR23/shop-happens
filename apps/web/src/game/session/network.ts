import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  ROOM_NAME,
  type BoxData,
  type BoxState,
  type Phase,
  type PlayerData,
  type SimEvent,
  type WorldView,
} from "@shop/shared";
import type { Session } from "./types";

class NetView implements WorldView {
  players = new Map<string, PlayerData>();
  boxes = new Map<string, BoxData>();
  delivered = 0;
  target = 5;
  phase: Phase = "playing";
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

  private mirror(state: any) {
    if (!state?.players || !state?.boxes) return; // first patch not decoded yet
    const v = this.view;
    v.delivered = state.delivered;
    v.target = state.target;
    v.phase = state.phase as Phase;
    v.players.clear();
    state.players.forEach((p: any, id: string) =>
      v.players.set(id, { id, name: p.name, colorIndex: p.colorIndex, x: p.x, z: p.z, rot: p.rot, heldBoxId: p.heldBoxId }),
    );
    v.boxes.clear();
    state.boxes.forEach((b: any, id: string) =>
      v.boxes.set(id, { id, x: b.x, z: b.z, state: b.state as BoxState, heldBy: b.heldBy, progress: b.progress, kind: b.kind }),
    );
  }

  sendMove(x: number, z: number, rot: number) {
    this.room.send(MSG.move, { x, z, rot });
  }
  pickup(boxId: string) {
    this.room.send(MSG.pickup, { boxId });
  }
  put(drop: boolean) {
    this.room.send(MSG.put, { drop });
  }
  update() {}
  dispose() {
    this.onDisconnect = undefined;
    void this.room.leave().catch(() => {});
  }
}
