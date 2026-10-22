export const ROOM_NAME = "shop";
export const MAX_PLAYERS = 5;
export const DELIVERY_TARGET = 5;

/** Server simulation + state patch rate. Render rate is independent. */
export const SERVER_TICK_HZ = 20;
export const CLIENT_SEND_HZ = 20;
/** Messages arriving faster than this are dropped by the server. */
export const MIN_MOVE_INTERVAL_MS = 30;
export const MIN_ACTION_INTERVAL_MS = 120;

export const PLAYER_RADIUS = 0.45;
export const PLAYER_SPEED = 5;
/** Server accepts reported movement up to this multiple of PLAYER_SPEED. */
export const SPEED_TOLERANCE = 1.6;
export const PICKUP_RANGE = 1.8;
/** How far in front of the worker a carried / dropped box sits. */
export const CARRY_DISTANCE = 0.85;
export const BOX_SIZE = 0.7;

export const WORLD = { minX: -12, maxX: 12, minZ: -8, maxZ: 8 } as const;

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Solid obstacles (shelves, machines, counters). Players are blocked by these. */
export const OBSTACLES: Record<string, Rect> = {
  backShelfA: { minX: -11.2, maxX: -7.4, minZ: -8, maxZ: -6.8 },
  backShelfB: { minX: -6.6, maxX: -3.2, minZ: -8, maxZ: -6.8 },
  conveyor: { minX: -3.6, maxX: 6.6, minZ: -5.2, maxZ: -3.8 },
  islandA: { minX: -1.5, maxX: 3, minZ: 2, maxZ: 3.1 },
  islandB: { minX: 5, maxX: 9, minZ: 2, maxZ: 3.1 },
  rightShelf: { minX: 11, maxX: 12, minZ: 0.5, maxZ: 7 },
  orderDesk: { minX: 11.2, maxX: 12, minZ: -7.5, maxZ: -2.5 },
};

export const CONVEYOR = {
  start: { x: -3, z: -4.5 },
  end: { x: 6, z: -4.5 },
  speed: 1.6,
  /** A held box can be put on the belt when the worker is this close to `start`. */
  inputRadius: 2.2,
  /** Minimum progress gap (world units) before another box may be placed. */
  minGap: 1.0,
  height: 0.85,
} as const;

export const CONVEYOR_LENGTH = Math.hypot(
  CONVEYOR.end.x - CONVEYOR.start.x,
  CONVEYOR.end.z - CONVEYOR.start.z,
);

/** Floor zone where boxes count as delivered. */
export const ORDER_ZONE: Rect = { minX: 6.9, maxX: 11, minZ: -7.5, maxZ: -2 };

export const BOX_SPAWNS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -9.5, z: 1.5 },
  { x: -8, z: 1.5 },
  { x: -6.5, z: 1.5 },
  { x: -9.5, z: 3.5 },
  { x: -8, z: 3.5 },
  { x: -6.5, z: 3.5 },
];

export const PLAYER_SPAWNS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -2, z: 5.5 },
  { x: -0.5, z: 5.5 },
  { x: 1, z: 5.5 },
  { x: 2.5, z: 5.5 },
  { x: 4, z: 5.5 },
];

/** Shirt colours (the reference worker wears orange). */
export const PLAYER_COLORS = [0xf57f17, 0x3f9142, 0x8e5bd6, 0xe0434b, 0x17a2b8] as const;

/** Time a delivered box lingers (for visual feedback) before removal. */
export const DELIVERED_LINGER_MS = 1200;
/** After the target is reached the round resets after this delay. */
export const ROUND_RESET_MS = 6000;
