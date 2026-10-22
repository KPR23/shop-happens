export type BoxType = "crate" | "goods";
export type BoxState = "available" | "held" | "onConveyor" | "flying";
export type DayPhase = "prep" | "open" | "closing" | "summary";
export type ActionKind = "" | "unpack" | "take" | "stock" | "scan" | "drive" | "open";
export type CustomerState = "toShelf" | "browsing" | "toQueue" | "waiting" | "leaving" | "leavingSad";

export interface PlayerData {
  id: string;
  name: string;
  colorIndex: number;
  x: number;
  z: number;
  rot: number;
  /** Empty string when not carrying. */
  heldBoxId: string;
  /** Hold-task in progress, or "". */
  action: ActionKind;
  actionProgress: number;
  /** True while driving the van to the wholesaler. */
  away: boolean;
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
  type: BoxType;
  /** Units of goods inside. */
  units: number;
}

export interface FixtureData {
  id: string;
  stock: number;
}

export interface CustomerData {
  id: string;
  x: number;
  z: number;
  rot: number;
  state: CustomerState;
  items: number;
  /** 1 = fresh, 0 = gives up. Only drops while queued. */
  patience: number;
  skin: number;
  /** Queue position (0 = at the register), -1 when not queued. */
  slot: number;
}

export interface VanData {
  state: "idle" | "away";
  driver: string;
  /** Seconds until it returns. */
  left: number;
}

export interface Upgrades {
  hands: number;
  deal: number;
  traffic: number;
}

export interface DayStats {
  earned: number;
  served: number;
  lost: number;
}

export type SimEvent =
  | { type: "sale"; amount: number; x: number; z: number }
  | { type: "lost"; x: number; z: number }
  | { type: "phase"; phase: DayPhase; day: number }
  | { type: "toast"; text: string }
  | { type: "minigame"; by: string; kind: "checkout" | "unpack"; reward: number };

/** Read-only view the renderer/HUD consumes (implemented by the local sim and the network adapter). */
export interface WorldView {
  players: ReadonlyMap<string, PlayerData>;
  boxes: ReadonlyMap<string, BoxData>;
  fixtures: ReadonlyMap<string, FixtureData>;
  customers: ReadonlyMap<string, CustomerData>;
  money: number;
  day: number;
  phase: DayPhase;
  /** Seconds left in the current phase. */
  phaseLeft: number;
  /** In-game clock, minutes after midnight. */
  clock: number;
  van: VanData;
  upgrades: Upgrades;
  stats: DayStats;
}
