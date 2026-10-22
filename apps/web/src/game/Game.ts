import * as THREE from "three";
import {
  CLIENT_SEND_HZ,
  PLAYER_DIAMETER,
  PLAYER_SPEED,
  isWalkable,
  resolveInteraction,
  resolveMove,
  type CustomerData,
  type Interaction,
  type PlayerData,
  type SimEvent,
} from "@shop/shared";
import { hud } from "../app/store";
import { Boxes } from "./entities/boxes";
import { Worker } from "./entities/worker";
import { Input } from "./input";
import { createMinigameHook } from "./minigames/hook";
import { World } from "./scene/world";
import type { Session } from "./session/types";

interface Actor {
  worker: Worker;
  x: number;
  z: number;
  rot: number;
  speed: number;
}

const angleLerp = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const fmtClock = (min: number) => {
  const m = Math.round(min / 5) * 5;
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** One renderer, one rAF loop. React never touches the per-frame path; HUD values are pushed only on change. */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 6, 90);
  private world = new World();
  private boxes = new Boxes();
  private input = new Input();
  private staff = new Map<string, Actor>();
  private shoppers = new Map<string, Actor>();
  private session: Session | null = null;
  private me = { x: 0, z: 0, rot: Math.PI, speed: 0, ready: false };
  private camTarget = new THREE.Vector3();
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private sendAcc = 0;
  private lastSent = { x: Infinity, z: Infinity, rot: Infinity };
  private highlight: string | null = null;
  private ro: ResizeObserver;
  private audio?: AudioContext;
  private disposed = false;
  private frames = 0;
  private ring: THREE.Mesh;
  private holdingE = false;
  private toastId = 0;
  private toastTimer = 0;
  /** Minigame entry point: gameplay code calls `game.minigames.launch(kind)` instead of starting hold-E. */
  readonly minigames;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    // ?lowfx: no shadows and a small canvas, for software-rendered browsers (CI, remote desktops)
    const lowfx = new URLSearchParams(location.search).has("lowfx");
    if (lowfx) this.renderer.setPixelRatio(0.6);
    this.renderer.shadowMap.enabled = !lowfx;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xf3e3c3);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0xd9b98f, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.1);
    sun.position.set(-9, 16, 8);
    sun.castShadow = !lowfx;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(this.world.group, this.boxes.root);

    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 28);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.minigames = createMinigameHook(container, () => this.session, () => this.input.clear());
    this.input.onPress = (code) => this.onKey(code);
    this.input.onRelease = (code) => this.onRelease(code);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    if (import.meta.env.DEV) {
      (window as unknown as { __shop: unknown }).__shop = () => ({
        server: this.session ? { ...this.session.view.players.get(this.session.localId) } : null,
        me: { ...this.me },
        frames: this.frames,
        keys: this.input.axis(),
        hud: hud.get(),
        view: this.session?.view,
      });
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  setSession(s: Session | null) {
    this.session?.dispose();
    this.staff.forEach((w) => w.worker.dispose());
    this.staff.clear();
    this.shoppers.forEach((w) => w.worker.dispose());
    this.shoppers.clear();
    this.boxes.clear();
    this.me.ready = false;
    this.holdingE = false;
    this.session = s;
    if (s) s.onEvent = (e) => this.onSimEvent(e);
  }

  buyUpgrade(id: string) {
    this.session?.upgrade(id);
  }

  private toast(text: string) {
    hud.set({ toast: { id: ++this.toastId, text } });
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => hud.set({ toast: null }), 4000);
  }

  private onSimEvent(e: SimEvent) {
    if (e.type === "sale") {
      this.world.sale(e.x, e.z, e.amount);
      this.ding();
    } else if (e.type === "lost") this.world.lost(e.x, e.z);
    else if (e.type === "toast") this.toast(e.text);
    else if (e.type === "phase") {
      this.toast(
        e.phase === "open" ? `Day ${e.day}: the store is OPEN!` : e.phase === "closing" ? "Closing time — customers are finishing up" : e.phase === "summary" ? `Day ${e.day} is over` : `Day ${e.day}: get the store ready!`,
      );
      if (e.phase === "open") this.ding(true);
    }
  }

  private ding(big = false) {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const t = ctx.currentTime;
      for (const [i, f] of (big ? [523, 659, 784, 1046] : [659, 988]).entries()) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.09);
        o.stop(t + i * 0.09 + 0.35);
      }
    } catch {
      /* audio is optional */
    }
  }

  /** The local worker as the shared rules see it: server state, but at the predicted position. */
  private localPlayer(): PlayerData | undefined {
    const s = this.session;
    const mine = s?.view.players.get(s.localId);
    return mine && { ...mine, x: this.me.x, z: this.me.z, rot: this.me.rot };
  }

  private interaction(): Interaction | null {
    const p = this.localPlayer();
    return p && this.session ? resolveInteraction(this.session.view, p) : null;
  }

  private onKey(code: string) {
    if (this.minigames.onKey(code)) return;
    if (code === "Escape") return hud.set({ showHelp: !hud.get().showHelp });
    const s = this.session;
    if (!s || !hud.get().started) return;
    const mine = s.view.players.get(s.localId);
    if (!mine || mine.away) return;
    if (code === "KeyE") {
      const i = this.interaction();
      if (!i) return;
      if (i.duration > 0) {
        this.holdingE = true;
        s.hold(true);
      } else if (i.kind === "pickup") s.pickup(i.targetId);
      else if (i.kind === "put") s.put();
    } else if (code === "KeyQ" && mine.heldBoxId) s.throwBox();
  }

  private onRelease(code: string) {
    if ((code === "KeyE" || code === "Blur") && this.holdingE) {
      this.holdingE = false;
      this.session?.hold(false);
    }
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 1.5 ? 32 * Math.min(1.9, 1.5 / this.camera.aspect) : 32;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.08, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.frames++;
    this.step(dt);
    if (this.minigames.active) this.minigames.update(dt);
    else this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number) {
    const s = this.session;
    const started = hud.get().started;
    s?.update(dt);
    const view = s?.view;

    if (s && view) {
      const mine = view.players.get(s.localId);
      if (mine && !this.me.ready) Object.assign(this.me, { x: mine.x, z: mine.z, rot: mine.rot, ready: true });

      if (mine && this.me.ready) {
        const busy = mine.away || mine.action !== "";
        const a = started && !busy ? this.input.axis() : { x: 0, z: 0 };
        const len = Math.hypot(a.x, a.z);
        const px = this.me.x;
        const pz = this.me.z;
        if (len > 0) {
          const r = resolveMove(px, pz, px + (a.x / len) * PLAYER_SPEED * dt, pz + (a.z / len) * PLAYER_SPEED * dt);
          this.me.x = r.x;
          this.me.z = r.z;
          this.me.rot = angleLerp(this.me.rot, Math.atan2(a.x, a.z), 1 - Math.exp(-dt * 16));
        }
        // other workers are soft obstacles: we give ground, the server shoves them along
        this.staff.forEach((o, id) => {
          if (id === s.localId || view.players.get(id)?.away) return;
          const dx = this.me.x - o.x;
          const dz = this.me.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d < PLAYER_DIAMETER && d > 1e-4) {
            const push = (PLAYER_DIAMETER - d) * 0.6;
            const nx = this.me.x + (dx / d) * push;
            const nz = this.me.z + (dz / d) * push;
            if (isWalkable(nx, nz)) {
              this.me.x = nx;
              this.me.z = nz;
            }
          }
        });
        this.me.speed = Math.hypot(this.me.x - px, this.me.z - pz) / Math.max(dt, 1e-3);
        // server reconciliation: gentle pull for small drift (pushes), hard snap for big jumps
        const drift = Math.hypot(mine.x - this.me.x, mine.z - this.me.z);
        if (drift > 2.5 || !isWalkable(this.me.x, this.me.z) || mine.away) {
          this.me.x = mine.x;
          this.me.z = mine.z;
        } else if (drift > 1.2) {
          this.me.x += (mine.x - this.me.x) * 0.2;
          this.me.z += (mine.z - this.me.z) * 0.2;
        }
        this.sendAcc += dt;
        if (this.sendAcc >= 1 / CLIENT_SEND_HZ) {
          this.sendAcc = 0;
          const l = this.lastSent;
          if (Math.abs(l.x - this.me.x) > 1e-3 || Math.abs(l.z - this.me.z) > 1e-3 || Math.abs(l.rot - this.me.rot) > 0.02) {
            s.sendMove(this.me.x, this.me.z, this.me.rot);
            this.lastSent = { x: this.me.x, z: this.me.z, rot: this.me.rot };
          }
        }
      }

      this.syncStaff(dt, view.players, s.localId);
      this.syncShoppers(dt, view.customers);
      this.updateHud(s);
      this.boxes.update(dt, this.time, view.boxes, (id) => this.staff.get(id) ?? (id === s.localId ? this.me : undefined), this.highlight);
      for (const f of view.fixtures.values()) this.world.setFixtureStock(f.id, f.stock);
      this.world.setVanAway(view.van.state === "away");
      this.world.setPhase(
        view.phase,
        view.phase === "prep" ? "Opens 09:00" : view.phase === "open" ? "Open until 18:00" : view.phase === "closing" ? "Closing up" : "See you tomorrow",
      );
    }

    this.world.update(dt, this.time);
    this.updateCamera(dt);
  }

  private syncStaff(dt: number, players: ReadonlyMap<string, PlayerData>, localId: string) {
    for (const [id, p] of players) {
      let w = this.staff.get(id);
      if (!w) {
        const worker = new Worker({ kind: "staff", colorIndex: p.colorIndex, name: p.name, isLocal: id === localId });
        this.scene.add(worker.group);
        w = { worker, x: p.x, z: p.z, rot: p.rot, speed: 0 };
        this.staff.set(id, w);
      }
      if (id === localId) {
        w.x = this.me.x;
        w.z = this.me.z;
        w.rot = this.me.rot;
        w.speed = this.me.speed;
      } else {
        // interpolate remote workers toward the latest server state
        const k = 1 - Math.exp(-dt * 12);
        const nx = w.x + (p.x - w.x) * k;
        const nz = w.z + (p.z - w.z) * k;
        w.speed = Math.hypot(nx - w.x, nz - w.z) / Math.max(dt, 1e-3);
        w.x = nx;
        w.z = nz;
        w.rot = angleLerp(w.rot, p.rot, k);
      }
      w.worker.setVisible(!p.away);
      w.worker.update(dt, w.x, w.z, w.rot, w.speed, !!p.heldBoxId, this.time, p.actionProgress);
    }
    for (const [id, w] of this.staff) {
      if (!players.has(id)) {
        w.worker.dispose();
        this.staff.delete(id);
      }
    }
  }

  private syncShoppers(dt: number, customers: ReadonlyMap<string, CustomerData>) {
    for (const [id, c] of customers) {
      let w = this.shoppers.get(id);
      if (!w) {
        const worker = new Worker({ kind: "customer", colorIndex: c.skin, name: "" });
        this.scene.add(worker.group);
        w = { worker, x: c.x, z: c.z, rot: c.rot, speed: 0 };
        this.shoppers.set(id, w);
      }
      const k = 1 - Math.exp(-dt * 10);
      const nx = w.x + (c.x - w.x) * k;
      const nz = w.z + (c.z - w.z) * k;
      w.speed = Math.hypot(nx - w.x, nz - w.z) / Math.max(dt, 1e-3);
      w.x = nx;
      w.z = nz;
      w.rot = angleLerp(w.rot, c.rot, k);
      if (c.state === "waiting") {
        const col = c.patience > 0.5 ? "rgba(47,179,107,0.95)" : c.patience > 0.25 ? "rgba(240,170,20,0.95)" : "rgba(224,67,75,0.95)";
        w.worker.setTag(`${c.items} item${c.items === 1 ? "" : "s"}`, { bg: col, fg: "#fff" });
      } else if (c.state === "leavingSad") w.worker.setTag("grr…", { bg: "rgba(224,67,75,0.95)", fg: "#fff" });
      else w.worker.setTag("");
      w.worker.update(dt, w.x, w.z, w.rot, w.speed, c.items > 0 && c.state !== "leaving", this.time, 0);
    }
    for (const [id, w] of this.shoppers) {
      if (!customers.has(id)) {
        w.worker.dispose();
        this.shoppers.delete(id);
      }
    }
  }

  private updateHud(s: Session) {
    const v = s.view;
    const mine = v.players.get(s.localId);
    const i = mine && hud.get().started ? this.interaction() : null;
    this.highlight = i?.kind === "pickup" ? i.targetId : null;
    let hint = "";
    if (i) {
      if (i.kind === "info") hint = i.label;
      else if (i.duration > 0) hint = `Hold [E] ${i.label.replace(/^Hold:\s*/, "")} (${i.duration.toFixed(1)}s)`;
      else hint = `[E] ${i.label}`;
    }
    if (mine?.heldBoxId && !mine.away && mine.action === "") hint += hint ? "   [Q] Throw" : "[Q] Throw";
    const hb = this.highlight ? v.boxes.get(this.highlight) : undefined;
    this.ring.visible = !!hb;
    if (hb) this.ring.position.set(hb.x, 0.12, hb.z);
    const taskLabels: Record<string, string> = { unpack: "Unpacking crate", take: "Taking goods", stock: "Stocking the shelf", scan: "Scanning items", drive: "Starting the van", open: "Opening the store" };
    hud.set({
      players: v.players.size,
      money: v.money,
      day: v.day,
      phase: v.phase,
      phaseLeft: Math.ceil(v.phaseLeft),
      clock: fmtClock(v.clock),
      earned: v.stats.earned,
      served: v.stats.served,
      lost: v.stats.lost,
      upgrades: v.upgrades,
      hint,
      taskLabel: mine?.action ? taskLabels[mine.action] : "",
      taskProgress: Math.round((mine?.actionProgress ?? 0) * 50) / 50,
      awayLeft: mine?.away ? Math.ceil(v.van.left) : 0,
    });
  }

  private updateCamera(dt: number) {
    const tx = THREE.MathUtils.clamp(this.me.x, -5, 5);
    const tz = THREE.MathUtils.clamp(this.me.z, -2.5, 3.5);
    const k = 1 - Math.exp(-dt * 4);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    this.camera.position.set(this.camTarget.x * 0.9, 23, this.camTarget.z + 20);
    this.camera.lookAt(this.camTarget.x * 0.9, 0.3, this.camTarget.z - 0.5);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastTimer);
    this.ro.disconnect();
    this.minigames.dispose();
    this.input.dispose();
    this.session?.dispose();
    this.staff.forEach((w) => w.worker.dispose());
    this.shoppers.forEach((w) => w.worker.dispose());
    this.world.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
  }
}
