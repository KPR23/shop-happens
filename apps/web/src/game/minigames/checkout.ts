import * as THREE from "three";
import type { MinigameReport } from "@shop/shared";
import { makeProduct, PRODUCTS } from "./products";
import type { Minigame, MinigameContext } from "./types";

const TOP = 0.8; // counter surface height
const SCANNER = { x: 0, z: 0.1, hw: 0.45, hd: 0.36 };
const BAG_X = 1.25;
const CLICK_PX = 8;

interface Item {
  obj: THREE.Group;
  type: number;
  home: THREE.Vector3;
  scanned: boolean;
  bagged: boolean;
  busy: boolean;
  slot: number;
}
interface Anim {
  item: Item;
  pts: THREE.Vector3[];
  seg: number;
  onPoint?: (i: number) => void;
  onDone?: () => void;
}

/**
 * First-person checkout: groceries on the belt, a scanner in the middle, a bagging area on the right.
 * Drag an item across the scanner window (or click it to swipe it automatically), then it is bagged.
 */
export class CheckoutGame implements Minigame {
  readonly id = "checkout" as const;
  onComplete?: (report: MinigameReport) => void;

  private ctx!: MinigameContext;
  private items: Item[] = [];
  private anims: Anim[] = [];
  private drag: { item: Item; startPx: THREE.Vector2; moved: boolean; offX: number; offZ: number } | null = null;
  private laser!: THREE.Mesh;
  private glass!: THREE.Mesh;
  private flash = 0;
  private scanOrder: number[] = [];
  private scans = 0;
  private bagged = 0;
  private nextSlot = 0;
  private finishIn = -1;
  private done = false;
  private tmp = new THREE.Vector3();

  start(ctx: MinigameContext) {
    this.ctx = ctx;
    const { scene, camera } = ctx.stage;
    scene.background = new THREE.Color(0xcfe6f2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-2, 5, 3);
    scene.add(sun);

    const counter = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.2, 2.6), new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.8 }));
    counter.position.set(0, TOP - 0.1, -0.1);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.02, 1.4), new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.9 }));
    belt.position.set(-1.9, TOP + 0.01, 0);
    const bagArea = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.02, 1.4), new THREE.MeshStandardMaterial({ color: 0x9fd3a8, roughness: 0.9 }));
    bagArea.position.set(BAG_X + 0.6, TOP + 0.01, 0);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshStandardMaterial({ color: 0xf2d9a8 }));
    wall.position.set(0, 2, -2.2);
    const base = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0xb7b1a6 }));
    base.position.set(0, -0.05, 0);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.95), new THREE.MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.5 }));
    deck.position.set(SCANNER.x, TOP + 0.02, SCANNER.z);
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(SCANNER.hw * 2, SCANNER.hd * 2), new THREE.MeshBasicMaterial({ color: 0x0b1c24 }));
    this.glass.rotation.x = -Math.PI / 2;
    this.glass.position.set(SCANNER.x, TOP + 0.045, SCANNER.z);
    this.laser = new THREE.Mesh(new THREE.PlaneGeometry(SCANNER.hw * 2, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9 }));
    this.laser.rotation.x = -Math.PI / 2;
    this.laser.position.set(SCANNER.x, TOP + 0.05, SCANNER.z);
    scene.add(counter, belt, bagArea, wall, base, deck, this.glass, this.laser);

    // first-person eye height, looking down at the counter
    camera.position.set(0, 1.6, 2.4);
    camera.lookAt(0, TOP, -0.2);
    // belt (left) through the last bag slot (right) must stay in frame at any aspect ratio
    ctx.stage.fit = { halfWidth: 3.2, distance: camera.position.distanceTo(new THREE.Vector3(0, TOP, -0.2)) };
    ctx.stage.resize();

    ctx.items.forEach((type, i) => {
      const obj = makeProduct(type);
      const home = new THREE.Vector3(-2.7 + (i % 4) * 0.5 + (Math.floor(i / 4) % 2) * 0.12, TOP, -0.35 + Math.floor(i / 4) * 0.55);
      obj.position.copy(home);
      obj.rotation.y = ((i * 37) % 11) / 11 - 0.5;
      scene.add(obj);
      this.items.push({ obj, type, home, scanned: false, bagged: false, busy: false, slot: -1 });
    });

    ctx.stage.onDown = () => this.down();
    ctx.stage.onMove = () => this.move();
    ctx.stage.onUp = () => this.up();
    this.refresh();
    ctx.ui.setHint("Drag each item across the scanner (or click it), then it lands in the bag");
  }

  private refresh() {
    this.ctx.ui.setCounter(this.scans, this.items.length, "Scanned");
  }

  private down() {
    if (this.done) return;
    const hit = this.ctx.stage.pick(this.items.filter((i) => !i.busy && !i.bagged).map((i) => i.obj));
    if (!hit) return;
    const item = this.items.find((i) => {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o === i.obj) return true;
        o = o.parent;
      }
      return false;
    });
    if (!item) return;
    const p = this.ctx.stage.planePoint(TOP + 0.1, this.tmp);
    this.drag = { item, startPx: this.ctx.stage.px.clone(), moved: false, offX: p ? item.obj.position.x - p.x : 0, offZ: p ? item.obj.position.z - p.z : 0 };
  }

  private move() {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && this.ctx.stage.px.distanceTo(d.startPx) > CLICK_PX) d.moved = true;
    if (!d.moved) return;
    const p = this.ctx.stage.planePoint(TOP + 0.1, this.tmp);
    if (!p) return;
    const o = d.item.obj;
    o.position.set(THREE.MathUtils.clamp(p.x + d.offX, -2.7, 2.7), TOP + 0.12, THREE.MathUtils.clamp(p.z + d.offZ, -0.9, 0.9));
    if (!d.item.scanned && this.inScanner(o.position)) this.scan(d.item);
  }

  private up() {
    const d = this.drag;
    this.drag = null;
    if (!d || this.done) return;
    const { item } = d;
    if (!d.moved) {
      // click: swipe the item over the scanner by itself, then bag it
      if (item.scanned) this.toBag(item);
      else {
        const above = new THREE.Vector3(SCANNER.x, TOP + 0.12, SCANNER.z);
        this.run({ item, pts: [item.obj.position.clone().setY(TOP + 0.3), new THREE.Vector3(SCANNER.x - 0.3, TOP + 0.12, SCANNER.z), above], seg: 0, onPoint: (i) => { if (i === 2 && !item.scanned) this.scan(item); }, onDone: () => this.toBag(item) });
      }
      return;
    }
    if (item.scanned) this.toBag(item);
    else {
      if (item.obj.position.x > BAG_X - 0.3) {
        this.ctx.beep(180, 160, "sawtooth");
        this.ctx.ui.flash("Scan it first!", false);
      }
      this.run({ item, pts: [item.obj.position.clone(), item.home.clone().setY(TOP + 0.15), item.home.clone()], seg: 0 });
    }
  }

  private inScanner(p: THREE.Vector3) {
    return Math.abs(p.x - SCANNER.x) < SCANNER.hw && Math.abs(p.z - SCANNER.z) < SCANNER.hd;
  }

  private scan(item: Item) {
    item.scanned = true;
    this.scans++;
    this.scanOrder.push(item.type);
    this.flash = 1;
    this.ctx.beep(1760, 100);
    this.ctx.ui.flash(PRODUCTS[item.type].name, true);
    this.refresh();
  }

  private toBag(item: Item) {
    if (item.slot < 0) item.slot = this.nextSlot++;
    const k = item.slot;
    const slot = new THREE.Vector3(BAG_X + (k % 4) * 0.36 + 0.1, TOP, -0.3 + Math.floor(k / 4) * 0.55);
    this.run({ item, pts: [item.obj.position.clone().setY(TOP + 0.3), slot.clone().setY(TOP + 0.3), slot], seg: 0, onDone: () => this.markBagged(item) });
  }

  private markBagged(item: Item) {
    if (item.bagged) return;
    item.bagged = true;
    this.bagged++;
    if (this.bagged === this.items.length) this.finishIn = 0.7;
  }

  private run(a: Anim) {
    this.anims = this.anims.filter((x) => x.item !== a.item);
    a.item.busy = true;
    this.anims.push(a);
  }

  update(dt: number) {
    for (const a of [...this.anims]) {
      const target = a.pts[a.seg];
      const o = a.item.obj;
      const dist = o.position.distanceTo(target);
      const step = 3.2 * dt;
      if (dist <= step) {
        o.position.copy(target);
        a.onPoint?.(a.seg);
        a.seg++;
        if (a.seg >= a.pts.length) {
          this.anims.splice(this.anims.indexOf(a), 1);
          a.item.busy = false;
          a.onDone?.();
        }
      } else o.position.addScaledVector(target.clone().sub(o.position), step / dist);
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    (this.laser.material as THREE.MeshBasicMaterial).color.setHex(this.flash > 0 ? 0x3dff7a : 0xff2a2a);
    (this.laser.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.sin(performance.now() / 120);
    (this.glass.material as THREE.MeshBasicMaterial).color.setHex(this.flash > 0 ? 0x1f6b3a : 0x0b1c24);
    this.laser.position.z = SCANNER.z + Math.sin(performance.now() / 260) * (SCANNER.hd - 0.05);

    if (this.finishIn >= 0 && !this.done) {
      this.finishIn -= dt;
      if (this.finishIn < 0) {
        this.done = true;
        this.onComplete?.(this.ctx.report(this.scanOrder, this.scans));
      }
    }
  }

  dispose() {
    this.ctx.stage.onDown = this.ctx.stage.onMove = this.ctx.stage.onUp = undefined;
    this.anims = [];
    this.drag = null;
  }
}
