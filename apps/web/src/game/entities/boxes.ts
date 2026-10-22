import * as THREE from "three";
import { BOX_SIZE, CARRY_DISTANCE, CONVEYOR, type BoxData, type PlayerData } from "@shop/shared";
import { toyMat } from "./common";

const H = 0.56;
const bodyGeo = new THREE.BoxGeometry(BOX_SIZE, H, BOX_SIZE);
const tapeGeo = new THREE.BoxGeometry(0.14, 0.012, BOX_SIZE + 0.01);
const labelGeo = new THREE.BoxGeometry(0.24, 0.16, 0.012);
const KINDS = [0xc89458, 0xd4a064, 0xbd8a4e];

interface Entry {
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  born: number;
  gone: number;
}

/** Cardboard box meshes, smoothed toward their authoritative positions. */
export class Boxes {
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();

  private build(kind: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, toyMat(KINDS[kind % KINDS.length], 0.8));
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
        e = { mesh: this.build(b.kind), x: b.x, y: H / 2, z: b.z, born: time, gone: -1 };
        this.root.add(e.mesh);
        this.entries.set(id, e);
      }
      let tx = b.x;
      let tz = b.z;
      let ty = H / 2;
      if (b.state === "held") {
        const h = holderPos(b.heldBy);
        if (h) {
          tx = h.x + Math.sin(h.rot) * CARRY_DISTANCE;
          tz = h.z + Math.cos(h.rot) * CARRY_DISTANCE;
        }
        ty = 0.95;
      } else if (b.state === "onConveyor") ty = CONVEYOR.height + H / 2;
      else if (b.state === "delivered" && e.gone < 0) e.gone = time;

      const k = b.state === "held" ? 1 : 1 - Math.exp(-dt * 18);
      e.x += (tx - e.x) * k;
      e.z += (tz - e.z) * k;
      e.y += (ty - e.y) * (1 - Math.exp(-dt * 14));
      e.mesh.position.set(e.x, e.y, e.z);

      // spawn pop-in, delivered shrink
      let s = Math.min(1, (time - e.born) * 5);
      s = 0.4 + 0.6 * s + Math.sin(Math.min(1, (time - e.born) * 5) * Math.PI) * 0.15;
      if (e.gone >= 0) s *= Math.max(0, 1 - (time - e.gone) / 0.5);
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

  worldPos(id: string) {
    return this.entries.get(id)?.mesh.position;
  }

  clear() {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
  }
}
export type { PlayerData };
