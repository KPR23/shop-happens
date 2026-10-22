/** Client -> server intents. The server never trusts a final outcome from a client. */
export const MSG = {
  move: "move",
  pickup: "pickup",
  /** Tap E while carrying and no task applies: set the box down (or onto the belt). */
  put: "put",
  /** Q: throw the carried box. */
  throw: "throw",
  /** Start/stop a hold-to-act task. The server decides which task applies. */
  hold: "hold",
  upgrade: "upgrade",
  /** Server -> client broadcast of SimEvent. */
  event: "event",
} as const;

export interface MoveMessage {
  x: number;
  z: number;
  rot: number;
}
export interface PickupMessage {
  boxId: string;
}
export interface HoldMessage {
  on: boolean;
}
export interface UpgradeMessage {
  id: string;
}
