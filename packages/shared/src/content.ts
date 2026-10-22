import { OBSTACLES, type Rect } from "./constants";

/** Tunable game data. Kept separate from rules so balancing (and later content packs) stays easy. */
export const ECON = {
  startMoney: 150,
  /** Selling price per unit of goods. */
  price: 6,
  vanCost: 50,
  /** Units in one wholesaler crate. */
  crateUnits: 12,
  /** Units in one tray of goods taken from a rack. */
  trayUnits: 6,
  vanCrates: 4,
  /** Bail-out money if the store is broke and has no stock at the start of a day. */
  emergencyFund: 60,
} as const;

/** Seconds. Short on purpose for the prototype. */
export const TIMING = {
  prep: 60,
  open: 120,
  closingMax: 40,
  summary: 10,
  vanTrip: 12,
  crateInterval: 1.4,
  customerBase: 7,
  customerPatience: 40,
  browse: 1.8,
  customerSpeed: 2.2,
  maxCustomers: 6,
} as const;

/** Base durations of hold-to-act tasks, in seconds (before the "hands" upgrade). */
export const HOLD = {
  unpack: 3,
  take: 2,
  stock: 5,
  drive: 2,
  open: 1.5,
  scanPerItem: 1,
} as const;

export type FixtureType = "rack" | "shelf";
export interface FixtureDef {
  id: string;
  type: FixtureType;
  rect: Rect;
  capacity: number;
  /** Where customers stand to browse a shelf. */
  stand?: { x: number; z: number };
  /** Initial stock. */
  stock: number;
}

export const FIXTURES: ReadonlyArray<FixtureDef> = [
  { id: "rackA", type: "rack", rect: OBSTACLES.rackA, capacity: 48, stock: 24 },
  { id: "rackB", type: "rack", rect: OBSTACLES.rackB, capacity: 48, stock: 0 },
  { id: "shelfA", type: "shelf", rect: OBSTACLES.shelfA, capacity: 18, stock: 0, stand: { x: 0.75, z: 3.9 } },
  { id: "shelfB", type: "shelf", rect: OBSTACLES.shelfB, capacity: 18, stock: 0, stand: { x: 7, z: 1.2 } },
  { id: "shelfC", type: "shelf", rect: OBSTACLES.shelfC, capacity: 18, stock: 0, stand: { x: -7, z: 3.9 } },
  { id: "shelfD", type: "shelf", rect: OBSTACLES.shelfD, capacity: 18, stock: 0, stand: { x: 10.1, z: 3.2 } },
];

export type UpgradeId = "hands" | "deal" | "traffic";
export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  costs: ReadonlyArray<number>;
}
export const UPGRADES: ReadonlyArray<UpgradeDef> = [
  { id: "hands", name: "Faster hands", description: "Hold-tasks take 20% less time per level", costs: [80, 160, 300] },
  { id: "deal", name: "Wholesaler deal", description: "+1 crate per van trip per level", costs: [100, 200, 350] },
  { id: "traffic", name: "Advertising", description: "+25% customers per level", costs: [90, 180, 320] },
];
export const MAX_UPGRADE_LEVEL = 3;

export const handsMultiplier = (level: number) => Math.pow(0.8, level);
