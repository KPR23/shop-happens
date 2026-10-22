import * as THREE from "three";
import {
  CASHIER_ZONE,
  CONVEYOR,
  CONVEYOR_LENGTH,
  DOOR,
  FIXTURES,
  OBSTACLES,
  QUEUE_SLOTS,
  VAN_ZONE,
  WORLD,
  type DayPhase,
  type FixtureDef,
  type Rect,
} from "@shop/shared";
import { Disposables, textSprite, toyMat } from "../entities/common";

const ORANGE = 0xe8622a;
const STEEL_BLUE = 0x2a67c9;
const YELLOW = 0xffc800;
const DARK = 0x33373d;
const PRODUCT_COLORS = [0xe0434b, 0xffc800, 0x3f9142, 0x2a67c9, 0xffffff, 0xf57f17, 0x8e5bd6];

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, res: Disposables) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = res.add(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface FixtureView {
  def: FixtureDef;
  mesh: THREE.InstancedMesh;
  perUnit: number;
  label?: { sprite: THREE.Sprite; dispose: () => void };
  shown: number;
}

/** The store: static building plus stock-driven shelves/racks, the van, door sign and small effects. */
export class World {
  readonly group = new THREE.Group();
  private res = new Disposables();
  private beltTex!: THREE.CanvasTexture;
  private doorCtx!: CanvasRenderingContext2D;
  private doorTex!: THREE.CanvasTexture;
  private doorKey = "";
  private van = new THREE.Group();
  private fixtures = new Map<string, FixtureView>();
  private confetti!: THREE.InstancedMesh;
  private particles: Array<{ p: THREE.Vector3; v: THREE.Vector3; life: number; spin: number }> = [];
  private popups: Array<{ s: THREE.Sprite; t: number; dispose: () => void }> = [];
  private dummy = new THREE.Object3D();
  private geos = new Map<string, THREE.BoxGeometry>();

  constructor() {
    this.buildFloor();
    this.buildWalls();
    for (const f of FIXTURES) this.buildFixture(f);
    this.buildConveyor();
    this.buildVan();
    this.buildRegister();
    this.buildDoor();
    this.buildDecor();
    this.buildConfetti();
  }

  private geo(w: number, h: number, d: number) {
    const k = `${w}|${h}|${d}`;
    let g = this.geos.get(k);
    if (!g) {
      g = this.res.add(new THREE.BoxGeometry(w, h, d));
      this.geos.set(k, g);
    }
    return g;
  }

  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, opts: { cast?: boolean; receive?: boolean; parent?: THREE.Object3D; rough?: number } = {}) {
    const m = new THREE.Mesh(this.geo(w, h, d), toyMat(color, opts.rough ?? 0.65));
    m.position.set(x, y, z);
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = opts.receive ?? true;
    (opts.parent ?? this.group).add(m);
    return m;
  }

  private label(text: string, x: number, y: number, z: number, bg = "rgba(31,42,68,0.88)", fg = "#fff", size = 32) {
    const t = textSprite(text, { bg, fg, size, scale: 0.0105 });
    t.sprite.position.set(x, y, z);
    this.group.add(t.sprite);
    this.res.add({ dispose: t.dispose });
    return t;
  }

  private buildFloor() {
    const tex = canvasTex(256, 256, (c) => {
      c.fillStyle = "#eadfc9";
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4; i++) {
        c.fillStyle = i % 3 === 0 ? "#e3d6bb" : "#ece2cf";
        c.fillRect((i % 2) * 128 + 3, Math.floor(i / 2) * 128 + 3, 122, 122);
      }
      c.strokeStyle = "#cdbf9f";
      c.lineWidth = 4;
      c.strokeRect(0, 0, 256, 256);
      c.beginPath();
      c.moveTo(128, 0);
      c.lineTo(128, 256);
      c.moveTo(0, 128);
      c.lineTo(256, 128);
      c.stroke();
    }, this.res);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 4);
    const floor = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(24, 16)), this.res.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    // warehouse floor tint (back strip) so the two zones read at a glance
    const wh = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(24, 5)), this.res.add(new THREE.MeshBasicMaterial({ color: 0x9aa3b5, transparent: true, opacity: 0.18 })));
    wh.rotation.x = -Math.PI / 2;
    wh.position.set(0, 0.012, -5.5);
    this.group.add(wh);
  }

  private hazardTex(repeat: number) {
    const t = canvasTex(128, 64, (c) => {
      c.fillStyle = "#ffc800";
      c.fillRect(0, 0, 128, 64);
      c.fillStyle = "#2b2e33";
      for (let i = -2; i < 6; i++) {
        c.beginPath();
        c.moveTo(i * 32, 64);
        c.lineTo(i * 32 + 16, 64);
        c.lineTo(i * 32 + 48, 0);
        c.lineTo(i * 32 + 32, 0);
        c.fill();
      }
    }, this.res);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, 1);
    return t;
  }

  private buildWalls() {
    const glass = this.res.add(new THREE.MeshBasicMaterial({ color: 0xbfe3f5, transparent: true, opacity: 0.6 }));
    const hazard = this.res.add(new THREE.MeshStandardMaterial({ map: this.hazardTex(24), roughness: 0.7 }));
    const H = 4.4;
    this.box(24.6, 1.2, 0.4, 0xc4552b, 0, 0.6, WORLD.minZ - 0.2);
    const bg = new THREE.Mesh(this.geo(24, 2.6, 0.1), glass);
    bg.position.set(0, 2.5, WORLD.minZ - 0.1);
    this.group.add(bg);
    this.box(24.6, 0.6, 0.5, ORANGE, 0, H - 0.3, WORLD.minZ - 0.2);
    const strip = new THREE.Mesh(this.geo(24, 0.18, 0.08), hazard);
    strip.position.set(0, 1.28, WORLD.minZ + 0.04);
    this.group.add(strip);
    for (let x = -12; x <= 12; x += 4) this.box(0.5, H, 0.5, ORANGE, x, H / 2, WORLD.minZ - 0.1);
    for (const sx of [-1, 1]) {
      const x = sx * (WORLD.maxX + 0.2);
      this.box(0.4, 1.2, 16.6, 0xc4552b, x, 0.6, 0);
      const g = new THREE.Mesh(this.geo(0.1, 2.6, 16), glass);
      g.position.set(sx * (WORLD.maxX + 0.1), 2.5, 0);
      this.group.add(g);
      this.box(0.5, 0.6, 16.6, ORANGE, x, H - 0.3, 0);
      for (let z = -8; z <= 8; z += 4) this.box(0.5, H, 0.5, ORANGE, x, H / 2, z);
    }
    this.box(1.7, 2.6, 0.12, STEEL_BLUE, -1.5, 1.3, WORLD.minZ + 0.06);
    this.box(0.14, 2.6, 0.2, YELLOW, -2.4, 1.3, WORLD.minZ + 0.1);
    this.box(0.14, 2.6, 0.2, YELLOW, -0.6, 1.3, WORLD.minZ + 0.1);
    const porthole = new THREE.Mesh(this.res.add(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20)), glass);
    porthole.rotation.x = Math.PI / 2;
    porthole.position.set(-1.5, 1.8, WORLD.minZ + 0.14);
    this.group.add(porthole);
    this.box(24.6, 0.35, 0.35, ORANGE, 0, H, WORLD.minZ + 0.6, { cast: false });
    this.label("WAREHOUSE", 2, 3.5, WORLD.minZ + 0.4, "rgba(232,98,42,0.95)", "#fff", 40);
  }

  // ---- shelves & racks ----------------------------------------------------------------------
  private buildFixture(def: FixtureDef) {
    const r = def.rect;
    const isRack = def.type === "rack";
    const alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
    const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
    const dep = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
    const g = new THREE.Group();
    g.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
    if (!alongX) g.rotation.y = Math.PI / 2;
    this.group.add(g);
    const levels = [0.12, 0.9, 1.68, 2.4];
    const post = isRack ? 0x555b66 : STEEL_BLUE;
    const plank = isRack ? 0xe0a02c : ORANGE;
    const posts = Math.max(2, Math.round(len / 1.9) + 1);
    for (let i = 0; i < posts; i++) {
      const px = -len / 2 + (len * i) / (posts - 1);
      for (const pz of [-dep / 2 + 0.04, dep / 2 - 0.04]) this.box(0.1, 2.52, 0.12, post, px, 1.25, pz, { parent: g });
    }
    for (const [i, y] of levels.entries()) this.box(len - 0.14, 0.08, dep - 0.1, plank, 0, y + i * 0.002, 0, { parent: g });

    // product / crate slots, shown according to the current stock
    const sides: number[] = isRack ? [0] : def.id === "shelfD" ? [-1] : [-1, 1];
    const perLevel = isRack ? 4 : 6;
    const slots = isRack ? 12 : def.capacity;
    const mesh = new THREE.InstancedMesh(this.res.add(new THREE.BoxGeometry(1, 1, 1)), this.res.add(new THREE.MeshStandardMaterial({ roughness: 0.6 })), slots);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.updateMatrix();
    const d = this.dummy;
    for (let i = 0; i < slots; i++) {
      const level = Math.floor(i / perLevel);
      const j = i % perLevel;
      const side = sides[j % sides.length];
      const cols = perLevel / sides.length;
      const col = Math.floor(j / sides.length);
      const lx = -len / 2 + (col + 0.5) * (len / cols);
      const w = isRack ? 0.7 : Math.min(0.55, (len / cols) * 0.62);
      const h = isRack ? 0.56 : 0.4 + (i % 3) * 0.05;
      const dd = isRack ? 0.7 : 0.28;
      const lz = side * (dep / 4);
      const local = new THREE.Vector3(lx, levels[level] + 0.045 + h / 2, lz);
      d.position.copy(local);
      d.rotation.set(0, 0, 0);
      d.scale.set(w, h, dd);
      d.updateMatrix();
      const m = new THREE.Matrix4().multiplyMatrices(g.matrix, d.matrix);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(isRack ? 0xc89458 : PRODUCT_COLORS[i % PRODUCT_COLORS.length]));
    }
    mesh.count = 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.res.add({ dispose: () => mesh.dispose() });
    this.fixtures.set(def.id, { def, mesh, perUnit: isRack ? 4 : 1, shown: -1 });
    this.setFixtureStock(def.id, def.stock);
  }

  setFixtureStock(id: string, stock: number) {
    const f = this.fixtures.get(id);
    if (!f || f.shown === stock) return;
    f.shown = stock;
    f.mesh.count = Math.min(f.mesh.instanceMatrix.count, Math.ceil(stock / f.perUnit));
    f.label?.sprite.parent?.remove(f.label.sprite);
    f.label?.dispose();
    const r = f.def.rect;
    const t = textSprite(`${stock}/${f.def.capacity}`, { bg: stock === 0 ? "rgba(224,67,75,0.92)" : "rgba(31,42,68,0.85)", size: 30, scale: 0.0085 });
    t.sprite.position.set((r.minX + r.maxX) / 2, f.def.type === "rack" ? 3.0 : 2.95, (r.minZ + r.maxZ) / 2);
    this.group.add(t.sprite);
    f.label = t;
  }

  // ---- conveyor -----------------------------------------------------------------------------
  private buildConveyor() {
    const r = OBSTACLES.conveyor;
    const len = r.maxX - r.minX;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const y = CONVEYOR.height - 0.03;
    this.box(len, 0.34, 1.4, DARK, cx, y - 0.2, cz);
    for (const s of [-1, 1]) {
      this.box(len, 0.3, 0.14, STEEL_BLUE, cx, y + 0.05, cz + s * 0.64);
      this.box(len + 0.1, 0.08, 0.2, YELLOW, cx, y + 0.22, cz + s * 0.64);
    }
    for (let x = r.minX + 0.5; x <= r.maxX - 0.4; x += 1.8) for (const s of [-1, 1]) this.box(0.18, 0.55, 0.18, 0x555b66, x, 0.28, cz + s * 0.56);
    this.beltTex = canvasTex(256, 128, (c) => {
      c.fillStyle = "#3b3f46";
      c.fillRect(0, 0, 256, 128);
      c.strokeStyle = "#ffc800";
      c.lineWidth = 16;
      c.lineJoin = "miter";
      for (const ox of [30, 160]) {
        c.beginPath();
        c.moveTo(ox, 24);
        c.lineTo(ox + 50, 64);
        c.lineTo(ox, 104);
        c.stroke();
      }
    }, this.res);
    this.beltTex.wrapS = this.beltTex.wrapT = THREE.RepeatWrapping;
    this.beltTex.repeat.set(CONVEYOR_LENGTH / 2.2, 1);
    const belt = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(CONVEYOR_LENGTH + 0.6, 1.1)), this.res.add(new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.9 })));
    belt.rotation.x = -Math.PI / 2;
    belt.position.set((CONVEYOR.start.x + CONVEYOR.end.x) / 2, CONVEYOR.height - 0.02, cz);
    belt.receiveShadow = true;
    this.group.add(belt);
    const chute = this.box(1.0, 0.1, 1.1, 0x8a93a3, r.maxX + 0.45, 0.62, cz);
    chute.rotation.z = -0.38;
    this.label("CRATES ▶", cx, 2.0, cz - 0.2, "rgba(255,200,0,0.95)", "#2a1a00");
  }

  // ---- wholesaler van -----------------------------------------------------------------------
  private buildVan() {
    const v = this.van;
    const x0 = (OBSTACLES.van.minX + OBSTACLES.van.maxX) / 2;
    const z0 = (OBSTACLES.van.minZ + OBSTACLES.van.maxZ) / 2;
    v.position.set(x0, 0, z0);
    this.group.add(v);
    this.box(3.2, 1.7, 2.2, 0xf4f4f4, 0.7, 1.3, 0, { parent: v });
    this.box(3.2, 0.25, 2.24, STEEL_BLUE, 0.7, 0.9, 0, { parent: v });
    this.box(1.3, 1.2, 2.1, YELLOW, -1.55, 1.0, 0, { parent: v });
    this.box(0.08, 0.6, 1.7, 0x9fd3f0, -2.22, 1.25, 0, { parent: v, cast: false });
    this.box(0.1, 1.5, 1.9, DARK, 2.33, 1.3, 0, { parent: v });
    const wheel = this.res.add(new THREE.CylinderGeometry(0.42, 0.42, 0.35, 16));
    for (const [x, z] of [[-1.5, 1.05], [-1.5, -1.05], [1.6, 1.05], [1.6, -1.05]] as const) {
      const w = new THREE.Mesh(wheel, toyMat(0x222428));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.42, z);
      w.castShadow = true;
      v.add(w);
    }
    // floor marking for the bay (visible when the van is out)
    const bay = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(VAN_ZONE.maxX - VAN_ZONE.minX, VAN_ZONE.maxZ - VAN_ZONE.minZ)), this.res.add(new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.16 })));
    bay.rotation.x = -Math.PI / 2;
    bay.position.set((VAN_ZONE.minX + VAN_ZONE.maxX) / 2, 0.02, (VAN_ZONE.minZ + VAN_ZONE.maxZ) / 2);
    this.group.add(bay);
    this.label("WHOLESALER VAN", x0, 2.9, z0 + 0.2, "rgba(61,120,201,0.95)", "#fff");
  }

  setVanAway(away: boolean) {
    this.van.visible = !away;
  }

  // ---- register & door ----------------------------------------------------------------------
  private buildRegister() {
    const r = OBSTACLES.register;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    this.box(r.maxX - r.minX, 1.0, r.maxZ - r.minZ, ORANGE, cx, 0.5, cz);
    this.box(r.maxX - r.minX + 0.1, 0.1, r.maxZ - r.minZ + 0.1, DARK, cx, 1.04, cz);
    this.box(1.6, 0.1, 0.8, 0x3b3f46, cx - 0.9, 1.12, cz - 0.1); // scanner belt
    this.box(0.5, 0.45, 0.1, DARK, cx + 0.9, 1.4, cz + 0.1).rotation.x = -0.25; // screen
    this.box(0.3, 0.12, 0.25, 0x8a93a3, cx + 0.2, 1.16, cz + 0.2); // card reader
    const mat = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(CASHIER_ZONE.maxX - CASHIER_ZONE.minX, CASHIER_ZONE.maxZ - CASHIER_ZONE.minZ)), this.res.add(new THREE.MeshBasicMaterial({ color: STEEL_BLUE, transparent: true, opacity: 0.3 })));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set((CASHIER_ZONE.minX + CASHIER_ZONE.maxX) / 2, 0.02, (CASHIER_ZONE.minZ + CASHIER_ZONE.maxZ) / 2);
    this.group.add(mat);
    this.label("CASH REGISTER — stand behind it", cx, 2.2, cz + 0.8, "rgba(42,103,201,0.95)", "#fff", 30);
    const dot = this.res.add(new THREE.RingGeometry(0.22, 0.3, 24));
    const dotMat = this.res.add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    for (const s of QUEUE_SLOTS) {
      const m = new THREE.Mesh(dot, dotMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x, 0.03, s.z);
      this.group.add(m);
    }
  }

  private buildDoor() {
    for (const dx of [-1.2, 1.2]) this.box(0.2, 3.5, 0.2, YELLOW, DOOR.x + dx, 1.75, WORLD.maxZ - 0.05);
    this.box(2.6, 0.2, 0.2, YELLOW, DOOR.x, 3.45, WORLD.maxZ - 0.05);
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 110;
    this.doorCtx = c.getContext("2d")!;
    this.doorTex = this.res.add(new THREE.CanvasTexture(c));
    this.doorTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(2.4, 0.825)), this.res.add(new THREE.MeshBasicMaterial({ map: this.doorTex })));
    sign.position.set(DOOR.x, 2.85, WORLD.maxZ + 0.06);
    this.group.add(sign);
    const mat = canvasTex(256, 96, (ctx) => {
      ctx.fillStyle = "#3b3f46";
      ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = "#ffc800";
      ctx.font = "800 40px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("WELCOME", 128, 62);
    }, this.res);
    const m = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(2.4, 0.9)), this.res.add(new THREE.MeshBasicMaterial({ map: mat })));
    m.rotation.x = -Math.PI / 2;
    m.position.set(DOOR.x, 0.025, DOOR.z + 0.15);
    this.group.add(m);
    this.setPhase("prep", "Opens soon");
  }

  /** Door sign: green OPEN during opening hours, red CLOSED otherwise. */
  setPhase(phase: DayPhase, sub: string) {
    const open = phase === "open";
    const key = `${open}|${sub}`;
    if (key === this.doorKey) return;
    this.doorKey = key;
    const c = this.doorCtx;
    c.fillStyle = open ? "#2fb36b" : "#c8323c";
    c.fillRect(0, 0, 320, 110);
    c.strokeStyle = "#fff";
    c.lineWidth = 6;
    c.strokeRect(5, 5, 310, 100);
    c.fillStyle = "#fff";
    c.textAlign = "center";
    c.font = "900 56px system-ui, sans-serif";
    c.fillText(open ? "OPEN" : "CLOSED", 160, 62);
    c.font = "700 24px system-ui, sans-serif";
    c.fillText(sub, 160, 94);
    this.doorTex.needsUpdate = true;
  }

  private buildDecor() {
    this.box(0.5, 0.08, 1.6, YELLOW, -10.9, 0.2, 5.8);
    this.box(0.12, 0.7, 0.12, YELLOW, -10.9, 0.6, 5.1);
    this.box(0.6, 0.06, 0.06, DARK, -10.9, 1.0, 5.1);
    this.box(0.7, 0.55, 0.7, 0xb5651d, -11.0, 0.28, 7.2);
    const leafGeo = this.res.add(new THREE.SphereGeometry(0.28, 10, 8));
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(leafGeo, toyMat(0x3f9142));
      l.position.set(-11.0 + Math.cos(i * 1.3) * 0.25, 0.95 + (i % 3) * 0.22, 7.2 + Math.sin(i * 1.3) * 0.25);
      l.scale.set(0.8, 1.3, 0.8);
      l.castShadow = true;
      this.group.add(l);
    }
    this.box(0.25, 0.3, 0.1, 0xd7263d, -9.0, 1.6, WORLD.minZ + 0.05, { cast: false });
    for (const x of [-4.4, 6.9]) this.box(0.25, 0.9, 0.25, YELLOW, x, 0.45, -2.9);
  }

  private buildConfetti() {
    const g = this.res.add(new THREE.BoxGeometry(0.12, 0.04, 0.08));
    this.confetti = new THREE.InstancedMesh(g, this.res.add(new THREE.MeshBasicMaterial()), 48);
    this.confetti.frustumCulled = false;
    const cols = [0xffc800, 0x3ddc84, 0xe0434b, 0x2a67c9, 0xffffff, 0xf57f17];
    for (let i = 0; i < 48; i++) this.confetti.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    this.confetti.count = 0;
    this.group.add(this.confetti);
  }

  private popup(text: string, x: number, z: number, bg: string, fg: string) {
    const pop = textSprite(text, { bg, fg, size: 50, scale: 0.014 });
    pop.sprite.position.set(x, 2.0, z);
    this.group.add(pop.sprite);
    this.popups.push({ s: pop.sprite, t: 0, dispose: pop.dispose });
  }

  sale(x: number, z: number, amount: number) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2;
      this.particles.push({ p: new THREE.Vector3(x, 1.4, z), v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 2.5, Math.sin(a) * s), life: 1 + Math.random() * 0.4, spin: Math.random() * 10 });
    }
    this.particles = this.particles.slice(-48);
    this.popup(`+$${amount}`, x, z, "rgba(61,220,132,0.96)", "#06301a");
  }

  lost(x: number, z: number) {
    this.popup("customer left", x, z, "rgba(224,67,75,0.95)", "#fff");
  }

  update(dt: number, time: number) {
    this.beltTex.offset.x -= (CONVEYOR.speed * dt) / 2.2;
    const d = this.dummy;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0 || p.p.y < 0.03) {
        this.particles.splice(i, 1);
        continue;
      }
      p.v.y -= 9 * dt;
      p.p.addScaledVector(p.v, dt);
    }
    for (const p of this.particles) {
      d.position.copy(p.p);
      d.rotation.set(p.spin + time * 6, p.spin * 2 + time * 4, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.confetti.setMatrixAt(n++, d.matrix);
    }
    this.confetti.count = n;
    this.confetti.instanceMatrix.needsUpdate = true;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      p.s.position.y += dt * 1.1;
      p.s.material.opacity = Math.max(0, 1 - p.t / 1.6);
      if (p.t > 1.6) {
        this.group.remove(p.s);
        p.dispose();
        this.popups.splice(i, 1);
      }
    }
  }

  dispose() {
    this.popups.forEach((p) => p.dispose());
    this.popups = [];
    this.fixtures.forEach((f) => f.label?.dispose());
    this.group.parent?.remove(this.group);
    this.res.disposeAll();
  }
}
export type { Rect };
