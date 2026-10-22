import * as THREE from "three";
import type { MinigameReport } from "@shop/shared";
import { makeProduct, PRODUCTS } from "./products";
import type { Minigame, MinigameContext } from "./types";

const TOP = 0.8;
const BOX = { x: 0, z: -0.2, w: 1.8, h: 0.55, d: 1.2 };
const BOX_TOP = TOP + BOX.h;
const TAPE_Z = BOX.z;
const X0 = -BOX.w / 2;
const X1 = BOX.w / 2;
const CRATE = { x: 2.0, z: 0.1 };
const SKIN = 0xf1c27d;

type Phase = "cut" | "open" | "take" | "done";

interface Item {
  obj: THREE.Group;
  type: number;
  taken: boolean;
}

function makeHand(sleeve: number): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.2), skin);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), skin);
  thumb.position.set(-0.11, 0, -0.04);
  thumb.rotation.y = 0.5;
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.11), skin);
  fingers.position.set(0, -0.005, -0.15);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 1.4), new THREE.MeshStandardMaterial({ color: sleeve, roughness: 0.9 }));
  arm.rotation.x = Math.PI / 2 - 0.4;
  arm.position.set(0, 0.28, 0.7);
  g.add(palm, thumb, fingers, arm);
  return g;
}

/**
 * Unpacking, seen over the player's hands: drag the box cutter along the tape to slit it open, then take
 * the products out one by one (the highlighted one is next) and put them in the crate.
 */
export class UnpackGame implements Minigame {
  readonly id = "unpack" as const;
  onComplete?: (report: MinigameReport) => void;

  private ctx!: MinigameContext;
  private phase: Phase = "cut";
  private items: Item[] = [];
  private next = 0;
  private takenOrder: number[] = [];
  private actions = 0;
  private cutX = X0;
  private cutting = false;
  private cutLine!: THREE.Mesh;
  private tape!: THREE.Mesh;
  private lid!: THREE.Mesh;
  private flapL = new THREE.Group();
  private flapR = new THREE.Group();
  private openT = 0;
  private hand = makeHand(0x2a67c9);
  private offHand = makeHand(0x2a67c9);
  private cutter = new THREE.Group();
  private handTarget = new THREE.Vector3(0, BOX_TOP + 0.3, 0.5);
  private carry: { item: Item; pts: THREE.Vector3[]; seg: number } | null = null;
  private placed = 0;
  private finishIn = -1;
  private pulse = 0;
  private tmp = new THREE.Vector3();

  start(ctx: MinigameContext) {
    this.ctx = ctx;
    const { scene, camera } = ctx.stage;
    scene.background = new THREE.Color(0xd9cdb8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-2, 5, 3);
    scene.add(sun);

    const table = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 3.2), new THREE.MeshStandardMaterial({ color: 0xb98b5e, roughness: 0.85 }));
    table.position.set(0.4, TOP - 0.1, 0);
    scene.add(table);

    // open-topped carton: floor + four walls, closed by a lid, two flaps and a strip of tape
    const card = new THREE.MeshStandardMaterial({ color: 0xc89a5b, roughness: 0.9 });
    const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), card);
      m.position.set(BOX.x + x, TOP + y, BOX.z + z);
      scene.add(m);
    };
    wall(BOX.w, 0.03, BOX.d, 0, 0.015, 0);
    wall(BOX.w, BOX.h, 0.03, 0, BOX.h / 2, BOX.d / 2);
    wall(BOX.w, BOX.h, 0.03, 0, BOX.h / 2, -BOX.d / 2);
    wall(0.03, BOX.h, BOX.d, BOX.w / 2, BOX.h / 2, 0);
    wall(0.03, BOX.h, BOX.d, -BOX.w / 2, BOX.h / 2, 0);

    this.lid = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, 0.02, BOX.d), card);
    this.lid.position.set(BOX.x, BOX_TOP, BOX.z);
    const flapGeo = new THREE.BoxGeometry(BOX.w / 2, 0.02, BOX.d);
    const fl = new THREE.Mesh(flapGeo, card);
    fl.position.x = BOX.w / 4;
    this.flapL.add(fl);
    this.flapL.position.set(X0, BOX_TOP, BOX.z);
    const fr = new THREE.Mesh(flapGeo, card);
    fr.position.x = -BOX.w / 4;
    this.flapR.add(fr);
    this.flapR.position.set(X1, BOX_TOP, BOX.z);
    this.flapL.visible = this.flapR.visible = false; // shown (hinged) once the lid is cut
    this.tape = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, 0.004, 0.14), new THREE.MeshStandardMaterial({ color: 0xe8d9a0, roughness: 0.4 }));
    this.tape.position.set(BOX.x, BOX_TOP + 0.012, TAPE_Z);
    this.cutLine = new THREE.Mesh(new THREE.BoxGeometry(1, 0.006, 0.025), new THREE.MeshBasicMaterial({ color: 0x5a1a10 }));
    this.cutLine.position.set(X0, BOX_TOP + 0.016, TAPE_Z);
    this.cutLine.scale.x = 0.001;
    scene.add(this.lid, this.flapL, this.flapR, this.tape, this.cutLine);

    // crate for unpacked goods
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3b7dd8, roughness: 0.7 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 1.0), crateMat);
    crate.position.set(CRATE.x, TOP + 0.02, CRATE.z);
    scene.add(crate);
    for (const [w, d, x, z] of [[1.2, 0.04, 0, -0.5], [1.2, 0.04, 0, 0.5], [0.04, 1.0, -0.6, 0], [0.04, 1.0, 0.6, 0]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), crateMat);
      m.position.set(CRATE.x + x, TOP + 0.1, CRATE.z + z);
      scene.add(m);
    }

    // products hidden in the carton, first one is taken first
    ctx.items.forEach((type, i) => {
      const obj = makeProduct(type);
      const cols = 3;
      obj.position.set(BOX.x + (i % cols - 1) * 0.5, TOP + 0.03, BOX.z + (Math.floor(i / cols) - 0.5) * 0.45);
      obj.rotation.y = ((i * 53) % 13) / 13 - 0.5;
      obj.visible = false;
      scene.add(obj);
      this.items.push({ obj, type, taken: false });
    });

    // hands + cutter
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.2), new THREE.MeshStandardMaterial({ color: 0xffc800 }));
    blade.position.set(0, 0.03, -0.2);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.07), new THREE.MeshStandardMaterial({ color: 0xcfd6dd, metalness: 0.8, roughness: 0.3 }));
    tip.position.set(0, 0.025, -0.34);
    this.cutter.add(blade, tip);
    this.hand.add(this.cutter);
    this.offHand.position.set(X0 - 0.35, BOX_TOP + 0.08, BOX.z + 0.45);
    this.offHand.scale.x = -1;
    this.hand.position.copy(this.handTarget);
    scene.add(this.hand, this.offHand);

    camera.position.set(0.2, 1.75, 1.9);
    camera.lookAt(0.2, TOP + 0.2, -0.15);

    ctx.stage.onDown = () => this.down();
    ctx.stage.onMove = () => this.move();
    ctx.stage.onUp = () => {
      this.cutting = false;
    };
    ctx.ui.setCounter(0, this.items.length, "Unpacked");
    ctx.ui.setHint("Hold and drag the box cutter along the tape, left to right");
  }

  private down() {
    if (this.phase === "cut") {
      this.cutting = true;
      this.move();
      return;
    }
    if (this.phase !== "take" || this.carry) return;
    const hit = this.ctx.stage.pick(this.items.filter((i) => !i.taken).map((i) => i.obj));
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
    if (item !== this.items[this.next]) {
      this.ctx.beep(180, 140, "sawtooth");
      this.ctx.ui.flash("Take the highlighted one first", false);
      return;
    }
    this.takeOut(item);
  }

  private move() {
    const p = this.ctx.stage.planePoint(this.phase === "cut" ? BOX_TOP + 0.12 : BOX_TOP + 0.4, this.tmp);
    if (p && !this.carry) this.handTarget.set(THREE.MathUtils.clamp(p.x, -2.4, 2.6), p.y, THREE.MathUtils.clamp(p.z, -1, 0.9));
    if (this.phase !== "cut" || !this.cutting || !p) return;
    // the blade must stay on the tape and advance continuously from the left end
    if (Math.abs(p.z - TAPE_Z) < 0.3 && p.x > this.cutX && p.x < this.cutX + 0.5) {
      this.cutX = Math.min(p.x, X1);
      const len = Math.max(0.001, this.cutX - X0);
      this.cutLine.scale.x = len;
      this.cutLine.position.x = X0 + len / 2;
      if (this.cutX >= X1 - 0.12) this.openBox();
    }
  }

  private openBox() {
    this.phase = "open";
    this.cutting = false;
    this.actions++; // the cut
    this.ctx.beep(520, 120, "triangle");
    this.lid.visible = false;
    this.tape.visible = false;
    this.cutLine.visible = false;
    this.flapL.visible = this.flapR.visible = true;
    this.cutter.visible = false;
    this.items.forEach((i) => (i.obj.visible = true));
    this.ctx.ui.setHint("Opened! Click the highlighted product to take it out");
  }

  private takeOut(item: Item) {
    item.taken = true;
    this.takenOrder.push(item.type);
    this.actions++;
    this.ctx.beep(880, 70, "triangle", 0.1);
    this.ctx.ui.flash(PRODUCTS[item.type].name, true);
    const slot = this.placed++;
    const dest = new THREE.Vector3(CRATE.x - 0.4 + (slot % 3) * 0.4, TOP + 0.04, CRATE.z - 0.25 + Math.floor(slot / 3) * 0.45);
    const from = item.obj.position;
    this.carry = { item, seg: 0, pts: [new THREE.Vector3(from.x, BOX_TOP + 0.5, from.z), new THREE.Vector3(dest.x, BOX_TOP + 0.5, dest.z), dest] };
    this.next++;
    this.ctx.ui.setCounter(this.takenOrder.length, this.items.length, "Unpacked");
  }

  update(dt: number) {
    this.pulse += dt;
    const lerpK = 1 - Math.exp(-dt * 14);
    this.hand.position.lerp(this.handTarget, lerpK);
    this.hand.rotation.y = THREE.MathUtils.lerp(this.hand.rotation.y, this.phase === "cut" ? 0 : 0.2, lerpK);

    if (this.phase === "open") {
      this.openT = Math.min(1, this.openT + dt / 0.6);
      const a = Math.PI * 0.62 * (1 - Math.pow(1 - this.openT, 3));
      this.flapL.rotation.z = a;
      this.flapR.rotation.z = -a;
      if (this.openT >= 1) {
        this.phase = "take";
        this.handTarget.set(0.2, BOX_TOP + 0.5, 0.5);
      }
    }

    if (this.phase === "take") {
      this.items.forEach((it, i) => {
        if (it.taken) return;
        const glow = i === this.next ? 0.25 + 0.2 * Math.sin(this.pulse * 6) : 0;
        it.obj.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m && "emissive" in m) {
            m.emissive.setHex(0xffffff);
            m.emissiveIntensity = glow;
          }
        });
      });
    }

    const c = this.carry;
    if (c) {
      const target = c.pts[c.seg];
      const o = c.item.obj;
      const dist = o.position.distanceTo(target);
      const step = 3.2 * dt;
      if (dist <= step) {
        o.position.copy(target);
        c.seg++;
        if (c.seg >= c.pts.length) {
          this.carry = null;
          this.ctx.beep(440, 60, "triangle", 0.08);
          this.handTarget.set(0.2, BOX_TOP + 0.5, 0.5);
          if (this.takenOrder.length === this.items.length) {
            this.phase = "done";
            this.finishIn = 0.7;
          }
        }
      } else o.position.addScaledVector(this.tmp.copy(target).sub(o.position), step / dist);
      this.handTarget.copy(o.position).add(this.tmp.set(0, 0.22, 0.1));
    }

    if (this.finishIn >= 0) {
      this.finishIn -= dt;
      if (this.finishIn < 0) {
        this.finishIn = -1;
        this.onComplete?.(this.ctx.report(this.takenOrder, this.actions));
      }
    }
  }

  dispose() {
    this.ctx.stage.onDown = this.ctx.stage.onMove = this.ctx.stage.onUp = undefined;
    this.carry = null;
  }
}
