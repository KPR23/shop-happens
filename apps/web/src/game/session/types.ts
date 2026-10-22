import type { SimEvent, WorldView } from "@shop/shared";

/** What the game needs from "the world": the offline sim and the Colyseus room both implement this. */
export interface Session {
  readonly localId: string;
  readonly view: WorldView;
  onEvent?: (e: SimEvent) => void;
  onDisconnect?: (reason: string) => void;
  sendMove(x: number, z: number, rot: number): void;
  pickup(boxId: string): void;
  put(): void;
  throwBox(): void;
  /** Start (true) or stop (false) the hold-to-act task that applies to the local worker. */
  hold(on: boolean): void;
  upgrade(id: string): void;
  update(dt: number): void;
  dispose(): void;
}
