import {
  BELT_LANDING,
  CARRY_DISTANCE,
  CONVEYOR,
  CONVEYOR_LENGTH,
  DOOR,
  MAX_PLAYERS,
  PICKUP_RANGE,
  PLAYER_DIAMETER,
  PLAYER_SPAWNS,
  PLAYER_SPEED,
  PUSH_SHARE,
  QUEUE_SLOTS,
  SPEED_TOLERANCE,
  THROW_DISTANCE,
  THROW_TIME,
  VAN_RETURN,
} from "./constants";
import { ECON, FIXTURES, MAX_UPGRADE_LEVEL, TIMING, UPGRADES, handsMultiplier, type UpgradeId } from "./content";
import { conveyorPoint, findPath, isWalkable, nearestFreeSpot, separateCircles } from "./geometry";
import { beltHasRoom, resolveInteraction, type Interaction } from "./interaction";
import type {
  ActionKind,
  BoxData,
  CustomerData,
  DayPhase,
  DayStats,
  FixtureData,
  PlayerData,
  SimEvent,
  Upgrades,
  VanData,
  WorldView,
} from "./types";

interface Customer extends CustomerData {
  path: Array<{ x: number; z: number }>;
  timer: number;
  shelfId: string;
  want: number;
  scanned: boolean;
}

interface Hold {
  kind: ActionKind;
  targetId: string;
  elapsed: number;
  duration: number;
}

const CLOSE_MINUTES = { prep: 420, open: 540, closing: 1080, end: 1140 };

/**
 * Authoritative game rules. Pure TypeScript with no I/O or rendering, so the Colyseus room and the
 * offline single-player mode run exactly the same code.
 *
 * Hold-to-act tasks go through `startHold` / `stopHold`; when one finishes `completeTask` applies its
 * effect. A future close-up minigame can call `startHold`, run its own UI, and the task still
 * completes server-side here.
 */
export class GameSim implements WorldView {
  players = new Map<string, PlayerData>();
  boxes = new Map<string, BoxData>();
  fixtures = new Map<string, FixtureData>();
  customers = new Map<string, Customer>();
  money: number = ECON.startMoney;
  day = 1;
  phase: DayPhase = "prep";
  phaseLeft: number = TIMING.prep + 15;
  clock = CLOSE_MINUTES.prep;
  van: VanData = { state: "idle", driver: "", left: 0 };
  upgrades: Upgrades = { hands: 0, deal: 0, traffic: 0 };
  stats: DayStats = { earned: 0, served: 0, lost: 0 };
  onEvent?: (e: SimEvent) => void;

  private rng: () => number;
  private time = 0;
  private nextId = 1;
  private lastMoveAt = new Map<string, number>();
  private holds = new Map<string, Hold>();
  private flights = new Map<string, number>();
  private queue: string[] = [];
  private reserved = new Map<string, number>();
  private pendingCrates = 0;
  private crateTimer = 0;
  private spawnTimer = 3;
  private phaseTotal: number = TIMING.prep + 15;
  private closingElapsed = 0;

  constructor(opts: { rng?: () => number } = {}) {
    this.rng = opts.rng ?? Math.random;
    for (const f of FIXTURES) this.fixtures.set(f.id, { id: f.id, stock: f.stock });
    this.spawnBox("crate", BELT_LANDING.x + 0.8, BELT_LANDING.z + 0.9);
    this.spawnBox("crate", BELT_LANDING.x, BELT_LANDING.z - 0.9);
  }

  // ---- players ------------------------------------------------------------------------------
  addPlayer(id: string, name: string): PlayerData | null {
    if (this.players.has(id) || this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.colorIndex));
    let colorIndex = 0;
    while (used.has(colorIndex)) colorIndex++;
    const spawn = PLAYER_SPAWNS[colorIndex % PLAYER_SPAWNS.length];
    const p: PlayerData = { id, name, colorIndex, x: spawn.x, z: spawn.z, rot: 0, heldBoxId: "", action: "", actionProgress: 0, away: false };
    this.players.set(id, p);
    return p;
  }

  /** Releases any carried box and cancels tasks so nothing stays locked to a missing player. */
  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.stopHold(id);
    if (p.heldBoxId) this.releaseToFloor(p);
    this.players.delete(id);
    this.lastMoveAt.delete(id);
  }

  /** Client-reported movement; rejected when out of bounds, inside solids, too fast, or while away. */
  move(id: string, x: number, z: number, rot: number, now: number): boolean {
    const p = this.players.get(id);
    if (!p || p.away || !Number.isFinite(rot)) return false;
    if (!isWalkable(x, z)) return false;
    const last = this.lastMoveAt.get(id) ?? now - 100;
    const dt = Math.min(Math.max((now - last) / 1000, 0.03), 0.5);
    const maxDist = PLAYER_SPEED * SPEED_TOLERANCE * dt + 0.3;
    if (Math.hypot(x - p.x, z - p.z) > maxDist) return false;
    this.lastMoveAt.set(id, now);
    p.x = x;
    p.z = z;
    p.rot = rot;
    // walking into someone nudges them (they take most of the overlap)
    for (const q of this.players.values()) {
      if (q === p || q.away) continue;
      const r = separateCircles(p, q, PLAYER_DIAMETER, PUSH_SHARE);
      Object.assign(p, r.a);
      Object.assign(q, r.b);
    }
    return true;
  }

  /** Gently resolves overlaps that were not caused by movement (spawns, van returns, lag). */
  private separatePlayers(): void {
    const list = [...this.players.values()].filter((p) => !p.away);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) >= PLAYER_DIAMETER) continue;
        const r = separateCircles(a, b, PLAYER_DIAMETER, 0.5);
        Object.assign(a, r.a);
        Object.assign(b, r.b);
      }
  }

  // ---- instant actions ----------------------------------------------------------------------
  pickup(id: string, boxId: string): boolean {
    const p = this.players.get(id);
    const b = this.boxes.get(boxId);
    if (!p || p.away || !b || p.heldBoxId) return false;
    if (b.state !== "available" && b.state !== "onConveyor") return false;
    if (Math.hypot(b.x - p.x, b.z - p.z) > PICKUP_RANGE) return false;
    this.stopHold(id);
    b.state = "held";
    b.heldBy = id;
    p.heldBoxId = b.id;
    this.placeHeld(p, b);
    return true;
  }

  /** Tap E while carrying: crate onto the belt when at its start, otherwise set the box down in front. */
  put(id: string): boolean {
    const p = this.players.get(id);
    const b = p && this.boxes.get(p.heldBoxId);
    if (!p || p.away || !b || b.state !== "held") return false;
    this.stopHold(id);
    p.heldBoxId = "";
    b.heldBy = "";
    if (b.type === "crate" && Math.hypot(p.x - CONVEYOR.start.x, p.z - CONVEYOR.start.z) <= CONVEYOR.inputRadius && beltHasRoom(this)) {
      b.state = "onConveyor";
      b.progress = 0;
      b.x = CONVEYOR.start.x;
      b.z = CONVEYOR.start.z;
      return true;
    }
    const spot = nearestFreeSpot(p.x + Math.sin(p.rot) * CARRY_DISTANCE, p.z + Math.cos(p.rot) * CARRY_DISTANCE, { x: p.x, z: p.z });
    b.state = "available";
    b.x = spot.x;
    b.z = spot.z;
    return true;
  }

  /** Q: throw the carried box a short, predictable distance (stops before obstacles). */
  throwBox(id: string): boolean {
    const p = this.players.get(id);
    const b = p && this.boxes.get(p.heldBoxId);
    if (!p || p.away || !b || b.state !== "held") return false;
    this.stopHold(id);
    let x = p.x + Math.sin(p.rot) * CARRY_DISTANCE;
    let z = p.z + Math.cos(p.rot) * CARRY_DISTANCE;
    for (let d = CARRY_DISTANCE; d < THROW_DISTANCE; d += 0.2) {
      const nx = p.x + Math.sin(p.rot) * d;
      const nz = p.z + Math.cos(p.rot) * d;
      if (!isWalkable(nx, nz, 0.3)) break;
      x = nx;
      z = nz;
    }
    p.heldBoxId = "";
    b.heldBy = "";
    b.state = "flying";
    b.x = x;
    b.z = z;
    this.flights.set(b.id, this.time + THROW_TIME);
    return true;
  }

  buyUpgrade(id: string, upgrade: string): boolean {
    if (!this.players.has(id)) return false;
    const def = UPGRADES.find((u) => u.id === upgrade);
    if (!def) return false;
    const level = this.upgrades[def.id as UpgradeId];
    if (level >= MAX_UPGRADE_LEVEL) return false;
    const cost = def.costs[level];
    if (this.money < cost) return false;
    this.money -= cost;
    this.upgrades[def.id as UpgradeId] = level + 1;
    this.emit({ type: "toast", text: `${def.name} upgraded to level ${level + 1}` });
    return true;
  }

  // ---- hold-to-act tasks ----------------------------------------------------------------------
  /** Starts the task that applies to this worker right now (see resolveInteraction). */
  startHold(id: string): Interaction | null {
    const p = this.players.get(id);
    if (!p || p.away || this.holds.has(id)) return null;
    const i = resolveInteraction(this, p);
    if (!i || i.duration <= 0 || i.kind === "put" || i.kind === "pickup" || i.kind === "info") return null;
    this.holds.set(id, { kind: i.kind as ActionKind, targetId: i.targetId, elapsed: 0, duration: i.duration });
    p.action = i.kind as ActionKind;
    p.actionProgress = 0;
    return i;
  }

  stopHold(id: string): void {
    if (!this.holds.delete(id)) return;
    const p = this.players.get(id);
    if (p) {
      p.action = "";
      p.actionProgress = 0;
    }
  }

  private completeTask(p: PlayerData, h: Hold): void {
    const box = p.heldBoxId ? this.boxes.get(p.heldBoxId) : undefined;
    const fixture = this.fixtures.get(h.targetId);
    switch (h.kind) {
      case "unpack":
        if (box && fixture) {
          fixture.stock += box.units;
          this.removeBox(box.id);
          p.heldBoxId = "";
        }
        break;
      case "take":
        if (fixture && !box) {
          fixture.stock -= ECON.trayUnits;
          const tray = this.spawnBox("goods", p.x, p.z);
          tray.state = "held";
          tray.heldBy = p.id;
          tray.units = ECON.trayUnits;
          p.heldBoxId = tray.id;
          this.placeHeld(p, tray);
        }
        break;
      case "stock":
        if (box && fixture) {
          fixture.stock += box.units;
          this.removeBox(box.id);
          p.heldBoxId = "";
        }
        break;
      case "scan": {
        const c = this.customers.get(h.targetId);
        if (c && c.state === "waiting") {
          const amount = c.items * ECON.price;
          this.money += amount;
          this.stats.earned += amount;
          this.stats.served++;
          this.emit({ type: "sale", amount, x: p.x, z: p.z });
          this.leaveQueue(c);
          this.sendOut(c, false);
        }
        break;
      }
      case "drive":
        this.money -= ECON.vanCost;
        this.van = { state: "away", driver: p.id, left: TIMING.vanTrip };
        p.away = true;
        this.emit({ type: "toast", text: `${p.name} drives to the wholesaler…` });
        break;
      case "open":
        if (this.phase === "prep") this.setPhase("open");
        break;
    }
  }

  // ---- simulation ---------------------------------------------------------------------------
  tick(dt: number): void {
    this.time += dt;
    for (const c of this.customers.values()) c.scanned = false;

    for (const p of this.players.values()) {
      const b = p.heldBoxId ? this.boxes.get(p.heldBoxId) : undefined;
      if (b) this.placeHeld(p, b);
    }
    for (const [id, until] of this.flights) {
      if (this.time >= until) {
        const b = this.boxes.get(id);
        if (b && b.state === "flying") b.state = "available";
        this.flights.delete(id);
      }
    }

    for (const [pid, h] of this.holds) {
      const p = this.players.get(pid)!;
      const i = resolveInteraction(this, p);
      if (!i || i.kind !== h.kind || i.targetId !== h.targetId) {
        this.stopHold(pid);
        continue;
      }
      h.duration = i.duration; // follows upgrades bought mid-task
      h.elapsed += dt;
      p.actionProgress = Math.min(1, h.elapsed / h.duration);
      if (h.kind === "scan") {
        const c = this.customers.get(h.targetId);
        if (c) c.scanned = true;
      }
      if (h.elapsed >= h.duration) {
        this.holds.delete(pid);
        p.action = "";
        p.actionProgress = 0;
        this.completeTask(p, h);
      }
    }

    this.separatePlayers();
    this.tickBelt(dt);
    this.tickVan(dt);
    this.tickDay(dt);
    this.tickCustomers(dt);
  }

  private tickBelt(dt: number): void {
    const belt = [...this.boxes.values()].filter((b) => b.state === "onConveyor").sort((a, b) => b.progress - a.progress);
    let limit = Infinity;
    for (const b of belt) {
      b.progress = Math.min(b.progress + CONVEYOR.speed * dt, limit);
      limit = b.progress - CONVEYOR.minGap;
      if (b.progress >= CONVEYOR_LENGTH) {
        const spot = this.freeSpotNear(BELT_LANDING.x, BELT_LANDING.z);
        b.state = "available";
        b.x = spot.x;
        b.z = spot.z;
        continue;
      }
      const pt = conveyorPoint(b.progress, CONVEYOR.start, CONVEYOR.end, CONVEYOR_LENGTH);
      b.x = pt.x;
      b.z = pt.z;
    }
  }

  private tickVan(dt: number): void {
    if (this.van.state === "away") {
      this.van.left -= dt;
      if (this.van.left <= 0) {
        const driver = this.players.get(this.van.driver);
        if (driver) {
          driver.away = false;
          driver.x = VAN_RETURN.x;
          driver.z = VAN_RETURN.z;
          driver.rot = Math.PI;
        }
        this.van = { state: "idle", driver: "", left: 0 };
        this.pendingCrates += ECON.vanCrates + this.upgrades.deal;
        this.crateTimer = 0;
        this.emit({ type: "toast", text: "The van is back! Crates are coming down the belt." });
      }
    }
    if (this.pendingCrates > 0) {
      this.crateTimer -= dt;
      if (this.crateTimer <= 0 && beltHasRoom(this)) {
        const b = this.spawnBox("crate", CONVEYOR.start.x, CONVEYOR.start.z);
        b.state = "onConveyor";
        this.pendingCrates--;
        this.crateTimer = TIMING.crateInterval;
      }
    }
  }

  private setPhase(phase: DayPhase): void {
    this.phase = phase;
    this.closingElapsed = 0;
    this.phaseTotal = phase === "open" ? TIMING.open : phase === "closing" ? TIMING.closingMax : phase === "summary" ? TIMING.summary : TIMING.prep;
    this.phaseLeft = this.phaseTotal;
    this.spawnTimer = 2;
    this.emit({ type: "phase", phase, day: this.day });
  }

  private tickDay(dt: number): void {
    this.phaseLeft = Math.max(0, this.phaseLeft - dt);
    const done = this.phaseTotal > 0 ? 1 - this.phaseLeft / this.phaseTotal : 1;
    switch (this.phase) {
      case "prep":
        this.clock = CLOSE_MINUTES.prep + done * (CLOSE_MINUTES.open - CLOSE_MINUTES.prep);
        if (this.phaseLeft <= 0) this.setPhase("open");
        break;
      case "open":
        this.clock = CLOSE_MINUTES.open + done * (CLOSE_MINUTES.closing - CLOSE_MINUTES.open);
        if (this.phaseLeft <= 0) this.setPhase("closing");
        break;
      case "closing":
        this.closingElapsed += dt;
        this.clock = CLOSE_MINUTES.closing + done * (CLOSE_MINUTES.end - CLOSE_MINUTES.closing);
        if (this.closingElapsed > TIMING.closingMax - 0.01) {
          for (const c of [...this.customers.values()]) if (c.state !== "leaving" && c.state !== "leavingSad") this.abandon(c);
        }
        if (this.customers.size === 0) this.setPhase("summary");
        break;
      case "summary":
        this.clock = CLOSE_MINUTES.end;
        if (this.phaseLeft <= 0) this.startNextDay();
        break;
    }
  }

  private startNextDay(): void {
    this.day++;
    this.stats = { earned: 0, served: 0, lost: 0 };
    let units = 0;
    for (const f of this.fixtures.values()) units += f.stock;
    for (const b of this.boxes.values()) units += b.type === "goods" ? b.units : b.units;
    if (this.money < ECON.vanCost && units === 0 && this.van.state === "idle" && this.pendingCrates === 0) {
      this.money += ECON.emergencyFund;
      this.emit({ type: "toast", text: `The owner tops up the till (+$${ECON.emergencyFund})` });
    }
    this.setPhase("prep");
  }

  // ---- customers ----------------------------------------------------------------------------
  private tickCustomers(dt: number): void {
    if (this.phase === "open") {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.customers.size < TIMING.maxCustomers) {
        this.spawnCustomer();
        this.spawnTimer = (TIMING.customerBase / (1 + 0.25 * this.upgrades.traffic)) * (0.7 + 0.6 * this.rng());
      }
    }
    for (const c of [...this.customers.values()]) {
      switch (c.state) {
        case "toShelf":
          if (this.follow(c, dt)) {
            c.state = "browsing";
            c.timer = TIMING.browse;
          }
          break;
        case "browsing":
          c.timer -= dt;
          if (c.timer <= 0) this.finishBrowsing(c);
          break;
        case "toQueue":
          if (this.follow(c, dt)) c.state = "waiting";
          break;
        case "waiting":
          if (!c.scanned) c.patience -= dt / TIMING.customerPatience;
          if (c.patience <= 0) this.abandon(c);
          break;
        case "leaving":
        case "leavingSad":
          if (this.follow(c, dt)) this.customers.delete(c.id);
          break;
      }
    }
  }

  private spawnCustomer(): void {
    const free = FIXTURES.filter((f) => f.type === "shelf" && (this.fixtures.get(f.id)!.stock - (this.reserved.get(f.id) ?? 0)) > 0);
    const pool = free.length ? free : FIXTURES.filter((f) => f.type === "shelf");
    const shelf = pool[Math.floor(this.rng() * pool.length)];
    const avail = free.length ? this.fixtures.get(shelf.id)!.stock - (this.reserved.get(shelf.id) ?? 0) : 0;
    const want = free.length ? Math.min(avail, 1 + Math.floor(this.rng() * 3)) : 0;
    this.reserved.set(shelf.id, (this.reserved.get(shelf.id) ?? 0) + want);
    const c: Customer = {
      id: `cust-${this.nextId++}`,
      x: DOOR.x,
      z: DOOR.z,
      rot: Math.PI,
      state: "toShelf",
      items: 0,
      patience: 1,
      skin: Math.floor(this.rng() * 5),
      slot: -1,
      path: [],
      timer: 0,
      shelfId: shelf.id,
      want,
      scanned: false,
    };
    this.customers.set(c.id, c);
    this.route(c, shelf.stand!.x, shelf.stand!.z);
  }

  private finishBrowsing(c: Customer): void {
    const f = this.fixtures.get(c.shelfId)!;
    this.reserved.set(c.shelfId, Math.max(0, (this.reserved.get(c.shelfId) ?? 0) - c.want));
    const n = Math.min(c.want, f.stock);
    if (n <= 0 || this.queue.length >= QUEUE_SLOTS.length) {
      this.abandon(c);
      return;
    }
    f.stock -= n;
    c.items = n;
    this.queue.push(c.id);
    this.retargetQueue();
  }

  /** Customer gives up (empty shelf, jammed queue, ran out of patience). */
  private abandon(c: Customer): void {
    this.leaveQueue(c);
    this.stats.lost++;
    this.emit({ type: "lost", x: c.x, z: c.z });
    this.sendOut(c, true);
  }

  private sendOut(c: Customer, sad: boolean): void {
    c.state = sad ? "leavingSad" : "leaving";
    c.slot = -1;
    this.route(c, DOOR.x, DOOR.z);
  }

  private leaveQueue(c: Customer): void {
    const i = this.queue.indexOf(c.id);
    if (i >= 0) this.queue.splice(i, 1);
    c.slot = -1;
    this.retargetQueue();
  }

  private retargetQueue(): void {
    this.queue.forEach((id, i) => {
      const c = this.customers.get(id);
      if (!c || c.slot === i) return;
      c.slot = i;
      c.state = "toQueue";
      this.route(c, QUEUE_SLOTS[i].x, QUEUE_SLOTS[i].z);
    });
  }

  private route(c: Customer, x: number, z: number): void {
    c.path = findPath(c.x, c.z, x, z);
  }

  /** Walks along the path; true once the last waypoint is reached. */
  private follow(c: Customer, dt: number): boolean {
    let budget = TIMING.customerSpeed * dt;
    while (c.path.length && budget > 0) {
      const t = c.path[0];
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      if (d <= budget) {
        c.x = t.x;
        c.z = t.z;
        budget -= d;
        c.path.shift();
      } else {
        c.rot = Math.atan2(t.x - c.x, t.z - c.z);
        c.x += ((t.x - c.x) / d) * budget;
        c.z += ((t.z - c.z) / d) * budget;
        budget = 0;
      }
    }
    return c.path.length === 0;
  }

  // ---- helpers ------------------------------------------------------------------------------
  private spawnBox(type: "crate" | "goods", x: number, z: number): BoxData {
    const id = `box-${this.nextId++}`;
    const b: BoxData = { id, x, z, state: "available", heldBy: "", progress: 0, type, units: type === "crate" ? ECON.crateUnits : ECON.trayUnits };
    this.boxes.set(id, b);
    return b;
  }

  private removeBox(id: string): void {
    this.boxes.delete(id);
    this.flights.delete(id);
  }

  private placeHeld(p: PlayerData, b: BoxData): void {
    b.x = p.x + Math.sin(p.rot) * CARRY_DISTANCE;
    b.z = p.z + Math.cos(p.rot) * CARRY_DISTANCE;
  }

  private releaseToFloor(p: PlayerData): void {
    const b = this.boxes.get(p.heldBoxId);
    p.heldBoxId = "";
    if (!b) return;
    const spot = nearestFreeSpot(p.x, p.z, { x: p.x, z: p.z });
    b.state = "available";
    b.heldBy = "";
    b.x = spot.x;
    b.z = spot.z;
  }

  private freeSpotNear(cx: number, cz: number) {
    for (let ring = 0; ring < 8; ring++) {
      for (let a = 0; a < (ring ? 8 : 1); a++) {
        const ang = (a / 8) * Math.PI * 2;
        const x = cx + Math.cos(ang) * ring * 0.8;
        const z = cz + Math.sin(ang) * ring * 0.8;
        if (!isWalkable(x, z, 0.3)) continue;
        if ([...this.boxes.values()].some((b) => b.state !== "held" && Math.hypot(b.x - x, b.z - z) < 0.75)) continue;
        return { x, z };
      }
    }
    return { x: cx, z: cz };
  }

  private emit(e: SimEvent): void {
    this.onEvent?.(e);
  }

  /** Total multiplier shown in the HUD for tasks. */
  get handsMult(): number {
    return handsMultiplier(this.upgrades.hands);
  }
}
