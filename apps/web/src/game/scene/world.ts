import * as THREE from "three";
import { BOX_SPAWNS, CONVEYOR, CONVEYOR_LENGTH, ORDER_ZONE, OBSTACLES, WORLD, type Rect } from "@shop/shared";
import { Disposables, textSprite, toyMat } from "../entities/common";

const ORANGE = 0xe8622a;
const STEEL_BLUE = 0x2a67c9;
const YELLOW = 0xffc800;
const DARK = 0x33373d;

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

/** Everything static (floor, walls, shelves, conveyor, order zone) plus small animated bits. */
export class World {
  readonly group = new THREE.Group();
  private res = new Disposables();
  private beltTex!: THREE.CanvasTexture;
  private zoneMat!: THREE.MeshBasicMaterial;
  private inputMat!: THREE.MeshBasicMaterial;
  private signCtx!: CanvasRenderingContext2D;
  private signTex!: THREE.CanvasTexture;
  private flashT = 0;
  private inputGlow = 0;
  private lastSign = "";
  private confetti!: THREE.InstancedMesh;
  private particles: Array<{ p: THREE.Vector3; v: THREE.Vector3; life: number; spin: number }> = [];
  private popups: Array<{ s: THREE.Sprite; t: number; dispose: () => void }> = [];
  private dummy = new THREE.Object3D();

  constructor() {
    this.buildFloor();
    this.buildWalls();
    this.buildShelves();
    this.buildConveyor();
    this.buildOrderZone();
    this.buildStock();
    this.buildDecor();
    this.buildConfetti();
    this.setProgress(0, 5);
  }

  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, opts: { cast?: boolean; receive?: boolean; parent?: THREE.Object3D; rough?: number } = {}) {
    const m = new THREE.Mesh(this.geo(w, h, d), toyMat(color, opts.rough ?? 0.65));
    m.position.set(x, y, z);
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = opts.receive ?? true;
    (opts.parent ?? this.group).add(m);
    return m;
  }
  private geos = new Map<string, THREE.BoxGeometry>();
  private geo(w: number, h: number, d: number) {
    const k = `${w}|${h}|${d}`;
    let g = this.geos.get(k);
    if (!g) {
      g = this.res.add(new THREE.BoxGeometry(w, h, d));
      this.geos.set(k, g);
    }
    return g;
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
    const geo = this.res.add(new THREE.PlaneGeometry(24, 16));
    const floor = new THREE.Mesh(geo, this.res.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
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
    // back wall (z = -8)
    this.box(24.6, 1.2, 0.4, 0xc4552b, 0, 0.6, WORLD.minZ - 0.2);
    const bg = new THREE.Mesh(this.geo(24, 2.6, 0.1), glass);
    bg.position.set(0, 2.5, WORLD.minZ - 0.1);
    this.group.add(bg);
    this.box(24.6, 0.6, 0.5, ORANGE, 0, H - 0.3, WORLD.minZ - 0.2);
    const strip = new THREE.Mesh(this.geo(24, 0.18, 0.08), hazard);
    strip.position.set(0, 1.28, WORLD.minZ + 0.04);
    this.group.add(strip);
    for (let x = -12; x <= 12; x += 4) this.box(0.5, H, 0.5, ORANGE, x, H / 2, WORLD.minZ - 0.1);
    // side walls
    for (const sx of [-1, 1]) {
      const x = sx * (WORLD.maxX + 0.2);
      this.box(0.4, 1.2, 16.6, 0xc4552b, x, 0.6, 0);
      const g = new THREE.Mesh(this.geo(0.1, 2.6, 16), glass);
      g.position.set(sx * (WORLD.maxX + 0.1), 2.5, 0);
      this.group.add(g);
      this.box(0.5, 0.6, 16.6, ORANGE, x, H - 0.3, 0);
      for (let z = -8; z <= 8; z += 4) this.box(0.5, H, 0.5, ORANGE, x, H / 2, z);
    }
    // blue service door with hazard frame
    this.box(1.7, 2.6, 0.12, STEEL_BLUE, -1.5, 1.3, WORLD.minZ + 0.06);
    this.box(0.14, 2.6, 0.2, YELLOW, -2.4, 1.3, WORLD.minZ + 0.1);
    this.box(0.14, 2.6, 0.2, YELLOW, -0.6, 1.3, WORLD.minZ + 0.1);
    const porthole = new THREE.Mesh(this.res.add(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20)), glass);
    porthole.rotation.x = Math.PI / 2;
    porthole.position.set(-1.5, 1.8, WORLD.minZ + 0.14);
    this.group.add(porthole);
    // beams across the open top edge for the industrial frame look
    this.box(24.6, 0.35, 0.35, ORANGE, 0, H, WORLD.minZ + 0.6, { cast: false });
  }

  private buildShelves() {
    const levels = [0.12, 0.9, 1.68, 2.4];
    const prodColors = [0xe0434b, 0xffc800, 0x3f9142, 0x2a67c9, 0xffffff, 0xf57f17, 0x8e5bd6];
    const prodGeo = this.res.add(new THREE.BoxGeometry(1, 1, 1));
    const prods = new THREE.InstancedMesh(prodGeo, this.res.add(new THREE.MeshStandardMaterial({ roughness: 0.55 })), 700);
    prods.castShadow = true;
    let n = 0;
    const d = this.dummy;
    const addProd = (x: number, y: number, z: number, w: number, h: number, dd: number, color: number) => {
      if (n >= 700) return;
      d.position.set(x, y, z);
      d.scale.set(w, h, dd);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      prods.setMatrixAt(n, d.matrix);
      prods.setColorAt(n, new THREE.Color(color));
      n++;
    };
    const rnd = mulberry(7);
    const shelf = (r: Rect, productSides: Array<-1 | 1>) => {
      const alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
      const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
      const dep = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      if (!alongX) g.rotation.y = Math.PI / 2;
      this.group.add(g);
      const posts = Math.max(2, Math.round(len / 1.9) + 1);
      for (let i = 0; i < posts; i++) {
        const px = -len / 2 + (len * i) / (posts - 1);
        for (const pz of [-dep / 2 + 0.04, dep / 2 - 0.04]) this.box(0.1, 2.52, 0.12, STEEL_BLUE, px, 1.25, pz, { parent: g });
      }
      for (const [i, y] of levels.entries()) this.box(len - 0.14, 0.08, dep - 0.1, ORANGE, 0, y + i * 0.002, 0, { parent: g });
      // products: rows on each level, boxes up top
      for (let li = 0; li < 3; li++) {
        for (const side of productSides) {
          let x = -len / 2 + 0.35;
          while (x < len / 2 - 0.3) {
            const top = li === 2 && rnd() < 0.45;
            const w = top ? 0.6 : 0.26 + rnd() * 0.1;
            const h = top ? 0.5 : 0.36 + rnd() * 0.2;
            const wz = top ? 0.5 : 0.24;
            const color = top ? 0xc89458 : prodColors[Math.floor(rnd() * prodColors.length)];
            const lz = productSides.length === 2 ? side * (dep / 4) : side * 0;
            const gx = x;
            // convert local -> world
            const lp = new THREE.Vector3(gx, levels[li] + 0.045 + h / 2, lz);
            lp.applyMatrix4(g.matrixWorld.identity().compose(g.position, g.quaternion, g.scale));
            if (rnd() < 0.88) addProd(lp.x, lp.y, lp.z, alongX ? w : wz, h, alongX ? wz : w, color);
            x += w + 0.08;
          }
        }
      }
    };
    shelf(OBSTACLES.backShelfA, [1]);
    shelf(OBSTACLES.backShelfB, [1]);
    shelf(OBSTACLES.islandA, [-1, 1]);
    shelf(OBSTACLES.islandB, [-1, 1]);
    shelf(OBSTACLES.rightShelf, [-1]);
    prods.count = n;
    prods.instanceMatrix.needsUpdate = true;
    if (prods.instanceColor) prods.instanceColor.needsUpdate = true;
    this.group.add(prods);
    this.res.add({ dispose: () => prods.dispose() });
  }

  private buildConveyor() {
    const r = OBSTACLES.conveyor;
    const len = r.maxX - r.minX;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const y = CONVEYOR.height - 0.03;
    // frame
    this.box(len, 0.34, 1.4, DARK, cx, y - 0.2, cz);
    for (const s of [-1, 1]) {
      this.box(len, 0.3, 0.14, STEEL_BLUE, cx, y + 0.05, cz + s * 0.64);
      this.box(len + 0.1, 0.08, 0.2, YELLOW, cx, y + 0.22, cz + s * 0.64);
    }
    for (let x = r.minX + 0.5; x <= r.maxX - 0.4; x += 1.8) for (const s of [-1, 1]) this.box(0.18, 0.55, 0.18, 0x555b66, x, 0.28, cz + s * 0.56);
    // belt with moving chevrons
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
    // output chute into the order zone
    const chute = this.box(1.0, 0.1, 1.1, 0x8a93a3, r.maxX + 0.45, 0.62, cz);
    chute.rotation.z = -0.38;
    this.box(0.14, 0.12, 1.3, YELLOW, r.maxX + 0.95, 0.38, cz);
    // input pad ring
    this.inputMat = this.res.add(new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(this.res.add(new THREE.RingGeometry(1.6, 1.95, 40)), this.inputMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(CONVEYOR.start.x - 0.8, 0.03, CONVEYOR.start.z + 1.2);
    this.group.add(ring);
    const inTag = textSprite("PUT BOX ON BELT ▶", { bg: "rgba(61,220,132,0.92)", fg: "#06301a", size: 34 });
    inTag.sprite.position.set(CONVEYOR.start.x - 0.8, 1.9, CONVEYOR.start.z + 1.2);
    this.group.add(inTag.sprite);
    this.res.add({ dispose: inTag.dispose });
  }

  private buildOrderZone() {
    const w = ORDER_ZONE.maxX - ORDER_ZONE.minX;
    const d = ORDER_ZONE.maxZ - ORDER_ZONE.minZ;
    const cx = (ORDER_ZONE.minX + ORDER_ZONE.maxX) / 2;
    const cz = (ORDER_ZONE.minZ + ORDER_ZONE.maxZ) / 2;
    this.zoneMat = this.res.add(new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.28 }));
    const pad = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(w, d)), this.zoneMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.02, cz);
    this.group.add(pad);
    const haz = this.res.add(new THREE.MeshStandardMaterial({ map: this.hazardTex(8) }));
    for (const [ww, dd, x, z] of [[w, 0.18, cx, ORDER_ZONE.minZ], [w, 0.18, cx, ORDER_ZONE.maxZ], [0.18, d, ORDER_ZONE.minX, cz]] as const) {
      const m = new THREE.Mesh(this.geo(ww, 0.03, dd), haz);
      m.position.set(x, 0.03, z);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // counter desk with screen
    const deskR = OBSTACLES.orderDesk;
    this.box(deskR.maxX - deskR.minX, 1.05, deskR.maxZ - deskR.minZ, ORANGE, (deskR.minX + deskR.maxX) / 2, 0.52, (deskR.minZ + deskR.maxZ) / 2);
    this.box(0.9, 0.08, 4.9, DARK, (deskR.minX + deskR.maxX) / 2 - 0.05, 1.08, (deskR.minZ + deskR.maxZ) / 2);
    this.box(0.1, 0.5, 0.7, DARK, 11.6, 1.4, -4.2);
    // big wall sign that shows the delivery count
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 160;
    this.signCtx = c.getContext("2d")!;
    this.signTex = this.res.add(new THREE.CanvasTexture(c));
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(this.res.add(new THREE.PlaneGeometry(4.4, 1.375)), this.res.add(new THREE.MeshBasicMaterial({ map: this.signTex })));
    sign.position.set(cx, 3.1, WORLD.minZ + 0.12);
    this.group.add(sign);
    this.box(4.6, 1.55, 0.08, DARK, cx, 3.1, WORLD.minZ + 0.07, { cast: false });
  }

  private buildStock() {
    const x0 = Math.min(...BOX_SPAWNS.map((s) => s.x)) - 1.2;
    const x1 = Math.max(...BOX_SPAWNS.map((s) => s.x)) + 1.2;
    const z0 = Math.min(...BOX_SPAWNS.map((s) => s.z)) - 1.2;
    const z1 = Math.max(...BOX_SPAWNS.map((s) => s.z)) + 1.2;
    for (const s of BOX_SPAWNS) {
      this.box(1.3, 0.05, 1.3, 0xb98b55, s.x, 0.025, s.z, { cast: false });
      for (let i = -1; i <= 1; i++) this.box(1.3, 0.025, 0.2, 0xa07640, s.x, 0.062, s.z + i * 0.45, { cast: false });
    }
    const dash = this.res.add(new THREE.MeshBasicMaterial({ color: YELLOW }));
    for (const [w, d, x, z] of [[x1 - x0, 0.1, (x0 + x1) / 2, z0], [x1 - x0, 0.1, (x0 + x1) / 2, z1], [0.1, z1 - z0, x0, (z0 + z1) / 2], [0.1, z1 - z0, x1, (z0 + z1) / 2]] as const) {
      const m = new THREE.Mesh(this.geo(w, 0.02, d), dash);
      m.position.set(x, 0.02, z);
      this.group.add(m);
    }
    const tag = textSprite("DELIVERIES — PICK UP BOXES HERE", { bg: "rgba(232,98,42,0.95)", size: 34 });
    tag.sprite.position.set((x0 + x1) / 2, 2.0, z0 - 0.2);
    this.group.add(tag.sprite);
    this.res.add({ dispose: tag.dispose });
  }

  private buildDecor() {
    // pallet jack
    this.box(0.5, 0.08, 1.6, YELLOW, -10.9, 0.2, 5.8);
    this.box(0.12, 0.7, 0.12, YELLOW, -10.9, 0.6, 5.1);
    this.box(0.6, 0.06, 0.06, DARK, -10.9, 1.0, 5.1);
    // plant
    this.box(0.7, 0.55, 0.7, 0xb5651d, 10.4, 0.28, 7.2);
    const leafGeo = this.res.add(new THREE.SphereGeometry(0.28, 10, 8));
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(leafGeo, toyMat(0x3f9142));
      l.position.set(10.4 + Math.cos(i * 1.3) * 0.25, 0.95 + (i % 3) * 0.22, 7.2 + Math.sin(i * 1.3) * 0.25);
      l.scale.set(0.8, 1.3, 0.8);
      l.castShadow = true;
      this.group.add(l);
    }
    // fire alarm + hazard bollards
    this.box(0.25, 0.3, 0.1, 0xd7263d, -9.0, 1.6, WORLD.minZ + 0.05, { cast: false });
    for (const x of [-4.4, 7.7]) this.box(0.25, 0.9, 0.25, YELLOW, x, 0.45, -2.9);
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

  /** Delivery feedback: confetti, floating +1, zone flash. */
  celebrate(x: number, z: number, count: number) {
    this.flashT = 1;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.2 + Math.random() * 2.2;
      this.particles.push({ p: new THREE.Vector3(x, 1.1, z), v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 3, Math.sin(a) * s), life: 1.1 + Math.random() * 0.5, spin: Math.random() * 10 });
    }
    this.particles = this.particles.slice(-48);
    const pop = textSprite(`+1  (${count})`, { bg: "rgba(61,220,132,0.96)", fg: "#06301a", size: 56, scale: 0.016 });
    pop.sprite.position.set(x, 1.6, z);
    this.group.add(pop.sprite);
    this.popups.push({ s: pop.sprite, t: 0, dispose: pop.dispose });
  }

  setProgress(n: number, target: number) {
    const key = `${n}/${target}`;
    if (key === this.lastSign) return;
    this.lastSign = key;
    const c = this.signCtx;
    c.fillStyle = "#23314f";
    c.fillRect(0, 0, 512, 160);
    c.fillStyle = "#ffc800";
    c.font = "800 34px system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText("BOXES DELIVERED", 256, 46);
    c.fillStyle = n >= target ? "#3ddc84" : "#fff";
    c.font = "900 84px system-ui, sans-serif";
    c.fillText(`${n} / ${target}`, 256, 132);
    this.signTex.needsUpdate = true;
  }

  setInputGlow(on: boolean) {
    this.inputGlow = on ? 1 : 0;
  }

  update(dt: number, time: number) {
    const speed = CONVEYOR.speed;
    this.beltTex.offset.x -= (speed * dt) / 2.2;
    this.flashT = Math.max(0, this.flashT - dt * 1.6);
    this.zoneMat.opacity = 0.28 + this.flashT * 0.5;
    this.inputMat.opacity = 0.2 + this.inputGlow * (0.35 + Math.sin(time * 6) * 0.2);

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
      p.s.material.opacity = Math.max(0, 1 - p.t / 1.4);
      if (p.t > 1.4) {
        this.group.remove(p.s);
        p.dispose();
        this.popups.splice(i, 1);
      }
    }
  }

  dispose() {
    this.popups.forEach((p) => p.dispose());
    this.popups = [];
    this.group.parent?.remove(this.group);
    this.res.disposeAll();
  }
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
