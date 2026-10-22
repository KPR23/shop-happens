export const ROOM_NAME = "shop";
export const MAX_PLAYERS = 5;

/** Server simulation + state patch rate. Render rate is independent. */
export const SERVER_TICK_HZ = 20;
export const CLIENT_SEND_HZ = 20;
/** Messages arriving faster than this are dropped by the server. */
export const MIN_MOVE_INTERVAL_MS = 30;
export const MIN_ACTION_INTERVAL_MS = 120;
export const MIN_HOLD_INTERVAL_MS = 60;

export const PLAYER_RADIUS = 0.45;
export const PLAYER_SPEED = 5;
/** Workers are soft circles: they cannot stand inside each other, and a mover nudges a bystander. */
export const PLAYER_DIAMETER = PLAYER_RADIUS * 2;
/** Share of an overlap the bystander absorbs when someone walks into them (the rest goes to the mover). */
export const PUSH_SHARE = 0.7;
/** Server accepts reported movement up to this multiple of PLAYER_SPEED. */
export const SPEED_TOLERANCE = 1.6;
export const PICKUP_RANGE = 1.8;
/** Distance from a shelf/rack/door at which hold-actions work. */
export const INTERACT_RANGE = 1.5;
/** How far in front of the worker a carried / put-down box sits. */
export const CARRY_DISTANCE = 0.85;
/** Q throws a box this far (stops early at obstacles); the flight lasts THROW_TIME seconds. */
export const THROW_DISTANCE = 3.2;
export const THROW_TIME = 0.5;
export const BOX_SIZE = 0.7;

export const WORLD = { minX: -12, maxX: 12, minZ: -8, maxZ: 8 } as const;

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Solid obstacles (shelves, machines, counters). Players and customers are blocked by these. */
export const OBSTACLES: Record<string, Rect> = {
  van: { minX: -11.2, maxX: -6.4, minZ: -7.9, maxZ: -5.6 },
  rackA: { minX: 7.8, maxX: 11.6, minZ: -8, maxZ: -6.8 },
  rackB: { minX: 11, maxX: 12, minZ: -6.2, maxZ: -2.2 },
  conveyor: { minX: -3.6, maxX: 6.6, minZ: -5.2, maxZ: -3.8 },
  shelfA: { minX: -1.5, maxX: 3, minZ: 2, maxZ: 3.1 },
  shelfB: { minX: 5, maxX: 9, minZ: 2, maxZ: 3.1 },
  shelfC: { minX: -9, maxX: -5, minZ: 2, maxZ: 3.1 },
  shelfD: { minX: 11, maxX: 12, minZ: 0.5, maxZ: 7 },
  register: { minX: 5, maxX: 8.5, minZ: 5.4, maxZ: 6.4 },
};

export const CONVEYOR = {
  start: { x: -3, z: -4.5 },
  end: { x: 6, z: -4.5 },
  speed: 1.6,
  /** A crate can be put on the belt when the worker is this close to `start`. */
  inputRadius: 2.2,
  /** Minimum progress gap (world units) before another crate may be placed. */
  minGap: 1.0,
  height: 0.85,
} as const;

export const CONVEYOR_LENGTH = Math.hypot(CONVEYOR.end.x - CONVEYOR.start.x, CONVEYOR.end.z - CONVEYOR.start.z);
/** Crates leaving the belt settle around this point, in front of the racks. */
export const BELT_LANDING = { x: 7.5, z: -4.5 };

export const PLAYER_SPAWNS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -3.5, z: 5.5 },
  { x: -2, z: 5.5 },
  { x: -0.5, z: 5.5 },
  { x: 1, z: 5.5 },
  { x: 2.5, z: 5.5 },
];

/** Shirt colours (the reference worker wears orange). */
export const PLAYER_COLORS = [0xf57f17, 0x3f9142, 0x8e5bd6, 0xe0434b, 0x17a2b8] as const;
/** Customers are dressed differently from the hard-hat staff. */
export const CUSTOMER_COLORS = [0xd94f8b, 0x4fa3d9, 0x9bc53d, 0xf2994a, 0x7a6ff0] as const;

export const DOOR = { x: -1.5, z: 7.5 };
export const VAN_ZONE: Rect = { minX: -11.5, maxX: -4.2, minZ: -5.4, maxZ: -2.2 };
export const VAN_RETURN = { x: -5.2, z: -2.8 };
export const CASHIER_ZONE: Rect = { minX: 5, maxX: 8.5, minZ: 6.5, maxZ: 7.6 };
export const QUEUE_SLOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 6.0, z: 4.65 },
  { x: 7.2, z: 4.65 },
  { x: 8.4, z: 4.65 },
  { x: 9.6, z: 4.65 },
];
