import { describe, expect, it } from "vitest";
import { GameSim } from "./sim";
import {
  MINIGAME_CONFIG,
  MINIGAME_START_COOLDOWN_MS,
  MinigameValidator,
  generateItems,
  parseMinigameReport,
  parseMinigameStart,
  seededRandom,
  type MinigameKind,
  type MinigameReport,
  type MinigameSession,
} from "./minigames";

const honest = (s: MinigameSession, over: Partial<MinigameReport> = {}): MinigameReport => {
  const cfg = MINIGAME_CONFIG[s.kind];
  return {
    sessionId: s.id,
    kind: s.kind,
    items: generateItems(s.seed, s.count),
    actions: cfg.actionsBase + s.count * cfg.actionsPerItem,
    clientDurationMs: 0,
    ...over,
  };
};
const minTime = (s: MinigameSession) => MINIGAME_CONFIG[s.kind].minBaseMs + s.count * MINIGAME_CONFIG[s.kind].minMsPerItem;

function open(v: MinigameValidator, kind: MinigameKind, now = 0) {
  const r = v.start("p1", kind, now);
  if (!r.ok) throw new Error(r.reason);
  return r.session;
}

describe("seeded generation", () => {
  it("is deterministic and bounded", () => {
    expect(generateItems(42, 6)).toEqual(generateItems(42, 6));
    expect(generateItems(42, 6)).not.toEqual(generateItems(43, 6));
    const r = seededRandom(1);
    for (let i = 0; i < 100; i++) expect(r()).toBeLessThan(1);
  });
});

describe("MinigameValidator", () => {
  for (const kind of ["checkout", "unpack"] as const) {
    it(`${kind}: issues a bounded session and rewards an honest report once`, () => {
      const v = new MinigameValidator();
      const s = open(v, kind);
      const cfg = MINIGAME_CONFIG[kind];
      expect(s.count).toBeGreaterThanOrEqual(cfg.minCount);
      expect(s.count).toBeLessThanOrEqual(cfg.maxCount);
      const res = v.complete("p1", honest(s), minTime(s));
      expect(res).toMatchObject({ ok: true, reward: s.count * cfg.rewardPerItem });
      expect(v.complete("p1", honest(s), minTime(s) + 10)).toMatchObject({ ok: false, reason: "no_session" }); // no double reward
    });
  }

  it("rejects a report that arrives too fast (server clock, not client claim)", () => {
    const v = new MinigameValidator();
    const s = open(v, "checkout");
    const res = v.complete("p1", honest(s, { clientDurationMs: 999_999 }), minTime(s) - 1);
    expect(res).toMatchObject({ ok: false, reason: "too_fast" });
    expect(v.hasActive("p1")).toBe(false); // consumed, cannot be retried
  });

  it("rejects too few actions", () => {
    const v = new MinigameValidator();
    const s = open(v, "unpack");
    expect(v.complete("p1", honest(s, { actions: s.count }), minTime(s))).toMatchObject({ ok: false, reason: "too_few_actions" });
  });

  it("rejects wrong, missing or extra items", () => {
    for (const mutate of [
      (i: number[]) => i.map((x) => (x + 1) % 8),
      (i: number[]) => i.slice(1),
      (i: number[]) => [...i, 0],
    ]) {
      const v = new MinigameValidator();
      const s = open(v, "checkout");
      const items = mutate(generateItems(s.seed, s.count));
      expect(v.complete("p1", honest(s, { items }), minTime(s))).toMatchObject({ ok: false, reason: "bad_items" });
    }
  });

  it("checkout accepts any order, unpack requires the generated order", () => {
    const seedSession = (kind: MinigameKind) => {
      // find a session whose items are not all equal so that reversing changes the order
      for (let i = 0; i < 50; i++) {
        const v = new MinigameValidator(seededRandom(i));
        const s = open(v, kind);
        const items = generateItems(s.seed, s.count);
        if (items.join() !== [...items].reverse().join()) return { v, s, items };
      }
      throw new Error("no suitable seed");
    };
    const c = seedSession("checkout");
    expect(c.v.complete("p1", honest(c.s, { items: [...c.items].reverse() }), minTime(c.s)).ok).toBe(true);
    const u = seedSession("unpack");
    expect(u.v.complete("p1", honest(u.s, { items: [...u.items].reverse() }), minTime(u.s))).toMatchObject({ ok: false, reason: "bad_items" });
  });

  it("rejects wrong kind, foreign session and expired sessions", () => {
    const v = new MinigameValidator();
    const s = open(v, "checkout");
    expect(v.complete("p1", honest(s, { sessionId: "mg-forged" }), minTime(s))).toMatchObject({ ok: false, reason: "wrong_session" });
    expect(v.hasActive("p1")).toBe(true); // a stray report does not cancel the real session
    expect(v.complete("p1", honest(s, { kind: "unpack" }), minTime(s))).toMatchObject({ ok: false, reason: "wrong_kind" });
    const s2 = open(v, "checkout", 10_000);
    expect(v.complete("p1", honest(s2), 10_000 + MINIGAME_CONFIG.checkout.maxMs + 1)).toMatchObject({ ok: false, reason: "expired" });
    expect(v.complete("other", honest(s2), 0)).toMatchObject({ ok: false, reason: "no_session" });
  });

  it("cannot complete after cancel, and throttles session starts", () => {
    const v = new MinigameValidator();
    const s = open(v, "checkout");
    v.cancel("p1");
    expect(v.complete("p1", honest(s), minTime(s))).toMatchObject({ ok: false, reason: "no_session" });
    expect(v.start("p1", "checkout", MINIGAME_START_COOLDOWN_MS - 1)).toMatchObject({ ok: false, reason: "cooldown" });
    expect(v.start("p1", "checkout", MINIGAME_START_COOLDOWN_MS).ok).toBe(true);
  });

  it("replaces an abandoned session so the old one cannot be reported", () => {
    const v = new MinigameValidator();
    const a = open(v, "checkout");
    const b = open(v, "checkout", 5000);
    expect(b.id).not.toBe(a.id);
    expect(v.complete("p1", honest(a), 20_000)).toMatchObject({ ok: false, reason: "wrong_session" });
  });
});

describe("message parsing", () => {
  it("accepts well-formed input only", () => {
    expect(parseMinigameStart({ kind: "checkout" })).toEqual({ kind: "checkout" });
    expect(parseMinigameStart({ kind: "hack" })).toBeNull();
    expect(parseMinigameStart(null)).toBeNull();
    const ok = { sessionId: "mg-1", kind: "unpack", items: [0, 3], actions: 3, clientDurationMs: 100 };
    expect(parseMinigameReport(ok)).toEqual(ok);
    expect(parseMinigameReport({ ...ok, items: [0, 99] })).toBeNull();
    expect(parseMinigameReport({ ...ok, items: [0.5] })).toBeNull();
    expect(parseMinigameReport({ ...ok, actions: -1 })).toBeNull();
    expect(parseMinigameReport({ ...ok, actions: NaN })).toBeNull();
    expect(parseMinigameReport({ ...ok, items: new Array(100).fill(0) })).toBeNull();
    expect(parseMinigameReport({ ...ok, sessionId: 5 })).toBeNull();
  });
});

describe("GameSim minigame integration", () => {
  it("grants the reward only through a validated report and emits one event", () => {
    const sim = new GameSim();
    sim.addPlayer("p1", "Ann");
    const events: string[] = [];
    sim.onEvent = (e) => events.push(e.type);
    expect(sim.startMinigame("ghost", "checkout", 0)).toMatchObject({ ok: false, reason: "no_player" });
    const r = sim.startMinigame("p1", "checkout", 0);
    if (!r.ok) throw new Error("start failed");
    const s = r.session;
    expect(sim.completeMinigame("p1", honest(s), 10)).toMatchObject({ ok: false, reason: "too_fast" });
    expect(sim.minigameScore.get("p1")).toBeUndefined();
    const r2 = sim.startMinigame("p1", "checkout", 2000);
    if (!r2.ok) throw new Error("start failed");
    expect(sim.completeMinigame("p1", honest(r2.session), 2000 + minTime(r2.session)).ok).toBe(true);
    expect(sim.minigameScore.get("p1")).toBe(r2.session.count * MINIGAME_CONFIG.checkout.rewardPerItem);
    expect(events.filter((t) => t === "minigame")).toHaveLength(1);
    sim.removePlayer("p1");
    expect(sim.minigameScore.has("p1")).toBe(false);
  });
});
