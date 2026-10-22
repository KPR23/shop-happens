/** Client -> server intents. The server never trusts a final outcome from a client. */
export const MSG = {
  move: "move",
  pickup: "pickup",
  put: "put",
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
export interface PutMessage {
  /** true = plain drop on the floor (Q); false = smart put-down (E: belt / order zone / floor). */
  drop: boolean;
}
