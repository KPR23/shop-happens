import * as THREE from "three";
import {
  CLIENT_SEND_HZ,
  CONVEYOR,
  ORDER_ZONE,
  CARRY_DISTANCE,
  PICKUP_RANGE,
  PLAYER_SPEED,
  isWalkable,
  pointInRect,
  resolveMove,
  type SimEvent,
} from "@shop/shared";
import { hud } from "../app/store";
import { Boxes } from "./entities/boxes";
import { Worker } from "./entities/worker";
import { Input } from "./input";
import { World } from "./scene/world";
import type { Session } from "./session/types";

interface Remote {
  worker: Worker;
  x: number;
  z: number;
  rot: number;
  speed: number;
  name: string;
}

const HINT_RANGE = PICKUP_RANGE - 0.3;
const angleLerp = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** One renderer, one rAF loop. React never touches the per-frame path; HUD values are pushed only on change. */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 6, 90);
  private world = new World();
  private boxes = new Boxes();
  private input = new Input();
  private workers = new Map<string, Remote>();
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
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.input.onPress = (code) => this.onKey(code);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __shop: unknown }).__shop = () => ({ server: this.session ? { ...this.session.view.players.get(this.session.localId) } : null, me: { ...this.me }, frames: this.frames, keys: this.input.axis() });
    this.raf = requestAnimationFrame(this.frame);
  }

  setSession(s: Session | null) {
    this.session?.dispose();
    this.workers.forEach((w) => w.worker.dispose());
    this.workers.clear();
    this.boxes.clear();
    this.me.ready = false;
    this.session = s;
    if (s) {
      s.onEvent = (e) => this.onSimEvent(e);
    }
  }

  private onSimEvent(e: SimEvent) {
    if (e.type === "delivered") {
      this.world.celebrate(e.x, e.z, e.count);
      this.ding();
    } else if (e.type === "complete") this.ding(true);
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

  private onKey(code: string) {
    if (code === "Escape") return hud.set({ showHelp: !hud.get().showHelp });
    const s = this.session;
    if (!s || !hud.get().started) return;
    const mine = s.view.players.get(s.localId);
    if (!mine) return;
    if (code === "KeyE") {
      if (mine.heldBoxId) s.put(false);
      else {
        const id = this.nearestBox();
        if (id) s.pickup(id);
      }
    } else if (code === "KeyQ" && mine.heldBoxId) s.put(true);
  }

  private nearestBox(): string | null {
    const s = this.session!;
    let best: string | null = null;
    let bd = HINT_RANGE;
    for (const b of s.view.boxes.values()) {
      if (b.state !== "available" && b.state !== "onConveyor") continue;
      const d = Math.hypot(b.x - this.me.x, b.z - this.me.z);
      if (d < bd) {
        bd = d;
        best = b.id;
      }
    }
    return best;
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the play area framed on narrow windows
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
    this.step(dt, now);
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number, now: number) {
    const s = this.session;
    const started = hud.get().started;
    s?.update(dt, now);
    const view = s?.view;

    if (s && view) {
      const mine = view.players.get(s.localId);
      if (mine && !this.me.ready) Object.assign(this.me, { x: mine.x, z: mine.z, rot: mine.rot, ready: true });

      if (mine && this.me.ready) {
        // movement: client-predicted with the shared collision rules; the server validates it
        const a = started ? this.input.axis() : { x: 0, z: 0 };
        const len = Math.hypot(a.x, a.z);
        const px = this.me.x;
        const pz = this.me.z;
        if (len > 0) {
          const r = resolveMove(px, pz, px + (a.x / len) * PLAYER_SPEED * dt, pz + (a.z / len) * PLAYER_SPEED * dt);
          this.me.x = r.x;
          this.me.z = r.z;
          this.me.rot = angleLerp(this.me.rot, Math.atan2(a.x, a.z), 1 - Math.exp(-dt * 16));
        }
        this.me.speed = Math.hypot(this.me.x - px, this.me.z - pz) / Math.max(dt, 1e-3);
        // server correction (rejected move, teleport, round reset)
        if (Math.hypot(mine.x - this.me.x, mine.z - this.me.z) > 2.5 || !isWalkable(this.me.x, this.me.z)) {
          this.me.x = mine.x;
          this.me.z = mine.z;
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

      this.syncWorkers(dt, view.players, s.localId);
      this.updateHint(s, view.phase);
      this.world.setProgress(view.delivered, view.target);
      hud.set({ delivered: view.delivered, target: view.target, players: view.players.size, round: view.phase });
      this.boxes.update(dt, this.time, view.boxes, (id) => this.holderPos(id, s.localId), this.highlight);
    }

    this.world.update(dt, this.time);
    this.updateCamera(dt);
  }

  private holderPos(id: string, localId: string) {
    if (id === localId) return this.me;
    return this.workers.get(id);
  }

  private syncWorkers(dt: number, players: ReadonlyMap<string, { id: string; name: string; colorIndex: number; x: number; z: number; rot: number; heldBoxId: string }>, localId: string) {
    for (const [id, p] of players) {
      let w = this.workers.get(id);
      if (!w) {
        const worker = new Worker(p.colorIndex, p.name, id === localId);
        this.scene.add(worker.group);
        w = { worker, x: p.x, z: p.z, rot: p.rot, speed: 0, name: p.name };
        this.workers.set(id, w);
      }
      const t = this.time;
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
      w.worker.update(dt, w.x, w.z, w.rot, w.speed, !!p.heldBoxId, t);
    }
    for (const [id, w] of this.workers) {
      if (!players.has(id)) {
        w.worker.dispose();
        this.workers.delete(id);
      }
    }
  }

  private updateHint(s: Session, phase: string) {
    const mine = s.view.players.get(s.localId);
    let hint = "";
    this.highlight = null;
    let nearInput = false;
    if (mine && hud.get().started) {
      if (mine.heldBoxId) {
        const fx = this.me.x + Math.sin(this.me.rot) * CARRY_DISTANCE;
        const fz = this.me.z + Math.cos(this.me.rot) * CARRY_DISTANCE;
        nearInput = Math.hypot(this.me.x - CONVEYOR.start.x, this.me.z - CONVEYOR.start.z) <= CONVEYOR.inputRadius;
        if (pointInRect(fx, fz, ORDER_ZONE) || pointInRect(this.me.x, this.me.z, ORDER_ZONE)) hint = "[E] Deliver box";
        else if (nearInput) hint = "[E] Put box on conveyor";
        else hint = "[E] Put down box   [Q] Drop";
      } else {
        const id = this.nearestBox();
        if (id) {
          this.highlight = id;
          hint = "[E] Pick up box";
        }
      }
    }
    if (phase === "complete") hint = "";
    this.world.setInputGlow(nearInput);
    hud.set({ hint });
    const hb = this.highlight && s.view.boxes.get(this.highlight);
    this.ring.visible = !!hb;
    if (hb) this.ring.position.set(hb.x, 0.12, hb.z);
  }

  private updateCamera(dt: number) {
    const tx = THREE.MathUtils.clamp(this.me.x, -6, 6);
    const tz = THREE.MathUtils.clamp(this.me.z, -2, 3);
    const k = 1 - Math.exp(-dt * 4);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    this.camera.position.set(this.camTarget.x * 0.9, 19, this.camTarget.z + 17);
    this.camera.lookAt(this.camTarget.x * 0.9, 0.3, this.camTarget.z - 0.5);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.dispose();
    this.session?.dispose();
    this.workers.forEach((w) => w.worker.dispose());
    this.world.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
  }
}
