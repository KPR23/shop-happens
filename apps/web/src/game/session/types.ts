import type { SimEvent, WorldView } from "@shop/shared";

/** What the game needs from "the world": the offline sim and the Colyseus room both implement this. */
export interface Session {
  readonly localId: string;
  readonly view: WorldView;
  onEvent?: (e: SimEvent) => void;
  onDisconnect?: (reason: string) => void;
  sendMove(x: number, z: number, rot: number): void;
  pickup(boxId: string): void;
  put(drop: boolean): void;
  update(dt: number, now: number): void;
  dispose(): void;
}
