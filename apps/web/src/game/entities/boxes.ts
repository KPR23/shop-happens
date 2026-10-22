import * as THREE from "three";
import { BOX_SIZE, CARRY_DISTANCE, CONVEYOR, THROW_TIME, type BoxData } from "@shop/shared";
import { toyMat } from "./common";

const H = 0.56;
const bodyGeo = new THREE.BoxGeometry(BOX_SIZE, H, BOX_SIZE);
const tapeGeo = new THREE.BoxGeometry(0.14, 0.012, BOX_SIZE + 0.01);
const labelGeo = new THREE.BoxGeometry(0.24, 0.16, 0.012);
const trayGeo = new THREE.BoxGeometry(BOX_SIZE, 0.26, 0.55);
const itemGeo = new THREE.BoxGeometry(0.17, 0.26, 0.15);
const ITEM_COLORS = [0xe0434b, 0xffc800, 0x3f9142, 0x2a67c9, 0xf57f17, 0x8e5bd6];

interface Entry {
  mesh: THREE.Group;
  type: string;
  x: number;
  y: number;
  z: number;
  born: number;
  flyFrom?: { x: number; z: number; t: number };
  wasFlying: boolean;
}

/** Crates (cardboard) and goods trays (plastic crate full of products), smoothed toward authoritative positions. */
export class Boxes {
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();

  private build(type: string) {
    const g = new THREE.Group();
    if (type === "goods") {
      const tray = new THREE.Mesh(trayGeo, toyMat(0x2a67c9, 0.5));
      tray.castShadow = true;
      tray.position.y = -0.15;
      g.add(tray);
      for (let i = 0; i < 6; i++) {
        const it = new THREE.Mesh(itemGeo, toyMat(ITEM_COLORS[i], 0.5));
        it.position.set(-0.22 + (i % 3) * 0.22, 0.1, i < 3 ? -0.1 : 0.1);
        it.castShadow = true;
        g.add(it);
      }
      return g;
    }
    const body = new THREE.Mesh(bodyGeo, toyMat(0xc89458, 0.8));
    body.castShadow = body.receiveShadow = true;
    const tape = new THREE.Mesh(tapeGeo, toyMat(0xe9d2a6, 0.5));
    tape.position.y = H / 2 + 0.003;
    const label = new THREE.Mesh(labelGeo, toyMat(0xffffff, 0.6));
    label.position.set(0, 0, BOX_SIZE / 2 + 0.006);
    const stripe = new THREE.Mesh(labelGeo, toyMat(0xf57f17, 0.6));
    stripe.scale.set(1, 0.25, 1);
    stripe.position.set(0, -0.2, BOX_SIZE / 2 + 0.006);
    g.add(body, tape, label, stripe);
    return g;
  }

  /** `holderPos` gives the rendered position of a worker so carried boxes never lag behind them. */
  update(
    dt: number,
    time: number,
    boxes: ReadonlyMap<string, BoxData>,
    holderPos: (p: string) => { x: number; z: number; rot: number } | undefined,
    highlightId: string | null,
  ) {
    for (const [id, b] of boxes) {
      let e = this.entries.get(id);
      if (!e) {
        e = { mesh: this.build(b.type), type: b.type, x: b.x, y: H / 2, z: b.z, born: time, wasFlying: false };
        this.root.add(e.mesh);
        this.entries.set(id, e);
      }
      let tx = b.x;
      let tz = b.z;
      let ty = b.type === "goods" ? 0.15 : H / 2;
      let hop = 0;
      if (b.state === "held") {
        const h = holderPos(b.heldBy);
        if (h) {
          tx = h.x + Math.sin(h.rot) * CARRY_DISTANCE;
          tz = h.z + Math.cos(h.rot) * CARRY_DISTANCE;
        }
        ty = 0.95;
      } else if (b.state === "onConveyor") ty = CONVEYOR.height + (b.type === "goods" ? 0.15 : H / 2);

      if (b.state === "flying") {
        // visible arc from the hands to the landing spot
        if (!e.flyFrom) e.flyFrom = { x: e.x, z: e.z, t: time };
        const u = Math.min(1, (time - e.flyFrom.t) / THROW_TIME);
        e.x = e.flyFrom.x + (tx - e.flyFrom.x) * u;
        e.z = e.flyFrom.z + (tz - e.flyFrom.z) * u;
        hop = Math.sin(u * Math.PI) * 1.1;
        e.y = 0.95 + (ty - 0.95) * u;
        e.wasFlying = true;
      } else {
        e.flyFrom = undefined;
        const k = b.state === "held" ? 1 : 1 - Math.exp(-dt * 18);
        e.x += (tx - e.x) * k;
        e.z += (tz - e.z) * k;
        e.y += (ty - e.y) * (1 - Math.exp(-dt * 14));
      }
      e.mesh.position.set(e.x, e.y + hop, e.z);
      e.mesh.rotation.x = b.state === "flying" ? (time - (e.flyFrom?.t ?? time)) * 9 : 0;

      // spawn pop-in
      let s = Math.min(1, (time - e.born) * 5);
      s = 0.4 + 0.6 * s + Math.sin(Math.min(1, (time - e.born) * 5) * Math.PI) * 0.15;
      const hl = id === highlightId ? 1 + Math.sin(time * 9) * 0.04 + 0.06 : 1;
      e.mesh.scale.setScalar(s * hl);
      e.mesh.rotation.y = b.state === "held" ? (holderPos(b.heldBy)?.rot ?? 0) : 0;
    }
    for (const [id, e] of this.entries) {
      if (!boxes.has(id)) {
        this.root.remove(e.mesh);
        this.entries.delete(id);
      }
    }
  }

  clear() {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
  }
}
