export type BoxState = "available" | "held" | "onConveyor" | "delivered";
export type Phase = "playing" | "complete";

export interface PlayerData {
  id: string;
  name: string;
  colorIndex: number;
  x: number;
  z: number;
  rot: number;
  /** Empty string when not carrying. */
  heldBoxId: string;
}

export interface BoxData {
  id: string;
  x: number;
  z: number;
  state: BoxState;
  /** Player id when held, else empty string. */
  heldBy: string;
  /** Distance travelled along the conveyor (world units), when onConveyor. */
  progress: number;
  /** Index into the box colour/label table, for future product variety. */
  kind: number;
}

export type SimEvent =
  | { type: "delivered"; boxId: string; by: string; count: number; x: number; z: number }
  | { type: "complete" }
  | { type: "reset" };

/** Read-only view the renderer/HUD consumes (implemented by the local sim and the network adapter). */
export interface WorldView {
  players: ReadonlyMap<string, PlayerData>;
  boxes: ReadonlyMap<string, BoxData>;
  delivered: number;
  target: number;
  phase: Phase;
}
