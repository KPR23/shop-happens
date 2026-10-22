/**
 * Minigame sessions: the server issues a session (kind, seed, item count) and later
 * validates the client's final report against it. The client can never award itself
 * a completion; it can only submit evidence that the server checks.
 *
 * Pure TypeScript (no I/O) so the Colyseus room and the offline LocalSession share it.
 */

export type MinigameKind = "checkout" | "unpack";
export const MINIGAME_KINDS: readonly MinigameKind[] = ["checkout", "unpack"];

/** Number of distinct product types the seeded generator can produce (client maps index -> look). */
export const PRODUCT_TYPES = 8;

export interface MinigameConfig {
  minCount: number;
  maxCount: number;
  /** Server-measured minimum wall time = minBaseMs + count * minMsPerItem. */
  minBaseMs: number;
  minMsPerItem: number;
  /** Minimum discrete player actions = actionsBase + count * actionsPerItem. */
  actionsBase: number;
  actionsPerItem: number;
  /** true: the items must be handled in exactly the generated order; false: any order. */
  ordered: boolean;
  /** Sessions older than this are expired. */
  maxMs: number;
  rewardPerItem: number;
}

export const MINIGAME_CONFIG: Record<MinigameKind, MinigameConfig> = {
  // actions = one scan per item
  checkout: { minCount: 4, maxCount: 8, minBaseMs: 800, minMsPerItem: 500, actionsBase: 0, actionsPerItem: 1, ordered: false, maxMs: 5 * 60_000, rewardPerItem: 10 },
  // actions = one cut + one take per item; items come out of the box in a fixed order
  unpack: { minCount: 3, maxCount: 6, minBaseMs: 1500, minMsPerItem: 700, actionsBase: 1, actionsPerItem: 1, ordered: true, maxMs: 5 * 60_000, rewardPerItem: 15 },
};

/** Minimum gap between starting two sessions for one player. */
export const MINIGAME_START_COOLDOWN_MS = 750;

export interface MinigameSession {
  id: string;
  kind: MinigameKind;
  seed: number;
  count: number;
}

/** Final evidence submitted by the client. `items` are product indices in the order it handled them. */
export interface MinigameReport {
  sessionId: string;
  kind: MinigameKind;
  items: number[];
  actions: number;
  /** Informational only; the server trusts its own clock. */
  clientDurationMs: number;
}

export type MinigameFailReason =
  | "bad_request"
  | "no_station"
  | "cooldown"
  | "no_session"
  | "wrong_session"
  | "wrong_kind"
  | "expired"
  | "bad_items"
  | "too_few_actions"
  | "too_fast"
  | "no_player";

export type MinigameStartResult = { ok: true; session: MinigameSession } | { ok: false; reason: MinigameFailReason };
export type MinigameResult =
  | { ok: true; sessionId: string; kind: MinigameKind; reward: number }
  | { ok: false; sessionId: string; kind: MinigameKind | null; reason: MinigameFailReason; reward: 0 };

export interface MinigameStartMessage {
  kind: MinigameKind;
}
export interface MinigameCancelMessage {
  sessionId?: string;
}

/** Small deterministic PRNG (mulberry32); the same seed gives the same sequence on client and server. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The product sequence for a session, derived from its seed. */
export function generateItems(seed: number, count: number): number[] {
  const rnd = seededRandom(seed);
  return Array.from({ length: count }, () => Math.floor(rnd() * PRODUCT_TYPES));
}

export const isMinigameKind = (v: unknown): v is MinigameKind => typeof v === "string" && (MINIGAME_KINDS as readonly string[]).includes(v);

/** Sanitises an untrusted start message; returns null when malformed. */
export function parseMinigameStart(msg: unknown): MinigameStartMessage | null {
  const m = msg as Partial<MinigameStartMessage> | null;
  return m && isMinigameKind(m.kind) ? { kind: m.kind } : null;
}

/** Sanitises an untrusted report; returns null when malformed (wrong types, absurd sizes). */
export function parseMinigameReport(msg: unknown): MinigameReport | null {
  const m = msg as Partial<MinigameReport> | null;
  if (!m || typeof m.sessionId !== "string" || m.sessionId.length > 48 || !isMinigameKind(m.kind)) return null;
  if (!Array.isArray(m.items) || m.items.length > 64) return null;
  if (!m.items.every((n) => Number.isInteger(n) && n >= 0 && n < PRODUCT_TYPES)) return null;
  if (!Number.isInteger(m.actions) || (m.actions as number) < 0 || (m.actions as number) > 10_000) return null;
  const d = typeof m.clientDurationMs === "number" && Number.isFinite(m.clientDurationMs) ? m.clientDurationMs : 0;
  return { sessionId: m.sessionId, kind: m.kind, items: m.items as number[], actions: m.actions as number, clientDurationMs: d };
}

interface Active {
  session: MinigameSession;
  startedAt: number;
}

/** Issues one session per player at a time and validates the final report exactly once. */
export class MinigameValidator {
  private active = new Map<string, Active>();
  private lastStartAt = new Map<string, number>();
  private counter = 0;

  constructor(private random: () => number = Math.random) {}

  hasActive(playerId: string): boolean {
    return this.active.has(playerId);
  }

  start(playerId: string, kind: MinigameKind, now: number): MinigameStartResult {
    if (!isMinigameKind(kind)) return { ok: false, reason: "bad_request" };
    const last = this.lastStartAt.get(playerId);
    if (last !== undefined && now - last < MINIGAME_START_COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    const cfg = MINIGAME_CONFIG[kind];
    const count = cfg.minCount + Math.floor(this.random() * (cfg.maxCount - cfg.minCount + 1));
    const seed = Math.floor(this.random() * 0xffffffff);
    const id = `mg-${++this.counter}-${Math.floor(this.random() * 0xffffff).toString(36)}`;
    const session: MinigameSession = { id, kind, seed, count };
    this.active.set(playerId, { session, startedAt: now }); // replaces an abandoned session
    this.lastStartAt.set(playerId, now);
    return { ok: true, session };
  }

  cancel(playerId: string): void {
    this.active.delete(playerId);
  }

  /** Forget everything about a player (disconnect). */
  remove(playerId: string): void {
    this.active.delete(playerId);
    this.lastStartAt.delete(playerId);
  }

  /** The session is single-use: it is consumed whether the report passes or not. */
  complete(playerId: string, report: MinigameReport, now: number): MinigameResult {
    const fail = (reason: MinigameFailReason, kind: MinigameKind | null = null): MinigameResult => ({ ok: false, sessionId: report?.sessionId ?? "", kind, reason, reward: 0 });
    const a = this.active.get(playerId);
    if (!a) return fail("no_session");
    if (!report || report.sessionId !== a.session.id) return fail("wrong_session"); // keep the session: a stray report must not cancel it
    this.active.delete(playerId);
    const { session } = a;
    if (report.kind !== session.kind) return fail("wrong_kind", session.kind);
    const cfg = MINIGAME_CONFIG[session.kind];
    const elapsed = now - a.startedAt;
    if (elapsed > cfg.maxMs) return fail("expired", session.kind);

    const expected = generateItems(session.seed, session.count);
    if (!Array.isArray(report.items) || report.items.length !== expected.length) return fail("bad_items", session.kind);
    const got = cfg.ordered ? report.items : [...report.items].sort((x, y) => x - y);
    const want = cfg.ordered ? expected : [...expected].sort((x, y) => x - y);
    if (got.some((v, i) => v !== want[i])) return fail("bad_items", session.kind);

    if (!Number.isInteger(report.actions) || report.actions < cfg.actionsBase + session.count * cfg.actionsPerItem) return fail("too_few_actions", session.kind);
    if (elapsed < cfg.minBaseMs + session.count * cfg.minMsPerItem) return fail("too_fast", session.kind);

    return { ok: true, sessionId: session.id, kind: session.kind, reward: session.count * cfg.rewardPerItem };
  }
}
