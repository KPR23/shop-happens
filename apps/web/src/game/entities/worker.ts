import * as THREE from "three";
import { CUSTOMER_COLORS, PLAYER_COLORS } from "@shop/shared";
import { Disposables, textSprite, toyMat } from "./common";

// Palette taken from the worker character sheet.
const SKIN = 0xf4c6a0;
const HAT = 0xffc800;
const OVERALLS = 0x2a67c9;
const GLOVE = 0x3f9142;
const DARK = 0x333638;
const BROWN = 0x8a4b25;
const GREY = 0xa8b0bd;
const HAIR = 0x4a2c1a;
const HAIRS = [0x4a2c1a, 0x1c1c1c, 0xc9902c, 0x8a3b1f, 0xb9b9b9];

const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const domeGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const barGeo = new THREE.PlaneGeometry(1, 1);

function part(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number], parent: THREE.Object3D) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export interface WorkerOptions {
  kind: "staff" | "customer";
  /** Colour index into the shirt palette (staff: player colour, customers: skin of the NPC). */
  colorIndex: number;
  name: string;
  isLocal?: boolean;
}

/**
 * Chunky toy-like character assembled from primitives. Faces +Z at rotation 0.
 * Staff wear the yellow hard hat and blue overalls from the character sheet; customers get plain clothes and hair.
 * Swap the body for a GLB later by replacing `body` while keeping this class's API.
 */
export class Worker {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private marker?: THREE.Group;
  private phase = Math.random() * 6;
  private carry = 0;
  private res = new Disposables();
  private tag?: { sprite: THREE.Sprite; dispose: () => void; text: string };
  private bar = new THREE.Group();
  private barFill: THREE.Mesh;
  private barMat: THREE.MeshBasicMaterial;
  private tagY: number;
  private style: { bg: string; fg: string };

  constructor(private opts: WorkerOptions) {
    const customer = opts.kind === "customer";
    const shirtColor = customer ? CUSTOMER_COLORS[opts.colorIndex % CUSTOMER_COLORS.length] : PLAYER_COLORS[opts.colorIndex % PLAYER_COLORS.length];
    const shirt = toyMat(shirtColor);
    const skin = toyMat(SKIN, 0.5);
    const pants = toyMat(customer ? [0x3b4a6b, 0x5a4b3a, 0x2f2f38, 0x4d6b5a, 0x6b3b4a][opts.colorIndex % 5] : OVERALLS);
    this.group.add(this.body);
    const b = this.body;

    // legs + shoes
    for (const [leg, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      leg.position.set(x, 0.52, 0);
      b.add(leg);
      part(cylGeo, pants, [0, -0.17, 0], [0.11, 0.34, 0.11], leg);
      if (!customer) part(cylGeo, toyMat(DARK), [0, -0.38, 0.02], [0.13, 0.12, 0.14], leg);
      part(boxGeo, toyMat(customer ? 0xf2f2f2 : DARK), [0, -0.42, 0.06], [0.22, 0.17, 0.32], leg);
      part(boxGeo, toyMat(customer ? 0x555555 : BROWN), [0, -0.5, 0.06], [0.24, 0.05, 0.34], leg);
    }

    // torso
    part(sphereGeo, pants, [0, 0.76, 0], [0.29, 0.27, 0.23], b);
    part(sphereGeo, shirt, [0, 0.98, 0], [0.29, 0.17, 0.22], b);
    if (!customer) {
      part(boxGeo, pants, [0, 0.9, 0.2], [0.3, 0.3, 0.07], b); // bib
      part(boxGeo, toyMat(0x3a78da), [0, 0.86, 0.245], [0.17, 0.1, 0.03], b); // pocket
      for (const x of [-0.12, 0.12]) {
        part(boxGeo, pants, [x, 1.0, 0.16], [0.05, 0.2, 0.05], b); // straps
        part(sphereGeo, toyMat(DARK), [x, 1.03, 0.2], [0.03, 0.03, 0.02], b); // buttons
      }
      part(cylGeo, toyMat(DARK), [0, 0.65, 0], [0.3, 0.07, 0.24], b); // belt
      part(boxGeo, toyMat(GREY), [0, 0.65, 0.235], [0.1, 0.07, 0.025], b);
    } else {
      part(boxGeo, shirt, [0, 0.86, 0.2], [0.34, 0.34, 0.05], b); // shirt front
    }

    // arms
    for (const [arm, x] of [[this.armL, -0.35], [this.armR, 0.35]] as const) {
      arm.position.set(x, 1.0, 0);
      b.add(arm);
      part(cylGeo, shirt, [0, -0.07, 0], [0.095, 0.16, 0.095], arm);
      part(cylGeo, skin, [0, -0.19, 0], [0.07, 0.1, 0.07], arm);
      if (!customer) {
        part(cylGeo, toyMat(GLOVE), [0, -0.27, 0], [0.105, 0.09, 0.105], arm);
        part(sphereGeo, toyMat(DARK), [0, -0.38, 0.01], [0.1, 0.1, 0.1], arm);
        part(boxGeo, toyMat(GLOVE), [0, -0.37, 0.07], [0.1, 0.09, 0.03], arm);
      } else {
        part(sphereGeo, skin, [0, -0.3, 0.01], [0.09, 0.09, 0.09], arm);
      }
    }

    // head: big and round, with ears, eyes, brows
    part(sphereGeo, skin, [0, 1.32, 0], [0.43, 0.4, 0.4], b);
    part(sphereGeo, skin, [-0.42, 1.28, 0], [0.085, 0.1, 0.07], b);
    part(sphereGeo, skin, [0.42, 1.28, 0], [0.085, 0.1, 0.07], b);
    const hair = toyMat(customer ? HAIRS[opts.colorIndex % HAIRS.length] : HAIR);
    part(sphereGeo, hair, [0, 1.34, -0.08], [0.42, 0.38, 0.38], b);
    for (const x of [-0.15, 0.15]) {
      part(sphereGeo, toyMat(0x2a1a12, 0.3), [x, 1.28, 0.36], [0.055, 0.075, 0.03], b);
      part(boxGeo, hair, [x, 1.37, 0.385], [0.13, 0.035, 0.03], b);
    }
    if (!customer) {
      const hat = toyMat(HAT, 0.45);
      part(domeGeo, hat, [0, 1.45, 0], [0.47, 0.43, 0.48], b);
      part(cylGeo, hat, [0, 1.46, 0.07], [0.52, 0.045, 0.55], b);
      part(boxGeo, hat, [0, 1.87, 0.02], [0.12, 0.05, 0.62], b);
      part(boxGeo, hat, [0, 1.65, 0.3], [0.2, 0.17, 0.12], b);
    } else {
      part(domeGeo, hair, [0, 1.5, -0.02], [0.44, 0.34, 0.44], b); // hair on top
    }

    // task progress bar (above the head), hidden until a hold-task runs
    this.barMat = this.res.add(new THREE.MeshBasicMaterial({ color: 0x3ddc84, depthTest: false, transparent: true }));
    const bg = new THREE.Mesh(barGeo, this.res.add(new THREE.MeshBasicMaterial({ color: 0x1f2a44, depthTest: false, transparent: true, opacity: 0.9 })));
    bg.scale.set(1.0, 0.16, 1);
    this.barFill = new THREE.Mesh(barGeo, this.barMat);
    this.barFill.renderOrder = 12;
    bg.renderOrder = 11;
    this.bar.add(bg, this.barFill);
    this.bar.position.y = 2.05;
    this.bar.visible = false;
    this.group.add(this.bar);

    this.tagY = 2.3;
    this.style = opts.isLocal ? { bg: "rgba(255,200,0,0.95)", fg: "#2a1a00" } : { bg: "rgba(30,40,70,0.82)", fg: "#fff" };
    if (!customer) this.setTag(opts.isLocal ? `${opts.name} ★` : opts.name);

    if (opts.isLocal) {
      const m = (this.marker = new THREE.Group());
      const ringGeo = this.res.add(new THREE.RingGeometry(0.62, 0.78, 32));
      const ringMat = this.res.add(new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      const arrowGeo = this.res.add(new THREE.ConeGeometry(0.16, 0.3, 4));
      const arrow = new THREE.Mesh(arrowGeo, ringMat);
      arrow.rotation.x = Math.PI;
      arrow.position.y = 2.15;
      arrow.name = "arrow";
      m.add(ring, arrow);
      this.group.add(m);
    }
  }

  /** (Re)builds the small label above the head only when the text changes. */
  setTag(text: string, style?: { bg: string; fg: string }) {
    if ((this.tag?.text ?? "") === text) return;
    this.tag?.sprite.parent?.remove(this.tag.sprite);
    this.tag?.dispose();
    this.tag = undefined;
    if (!text) return;
    const t = textSprite(text, { ...(style ?? this.style), size: 34, scale: 0.0062 });
    t.sprite.position.set(0, this.tagY, 0);
    this.group.add(t.sprite);
    this.tag = { ...t, text };
  }

  /** x/z world position, rot yaw, speed in units/s, carrying a box, time for idle motion. */
  update(dt: number, x: number, z: number, rot: number, speed: number, carrying: boolean, time: number, progress = 0) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rot;
    const moving = speed > 0.3;
    this.phase += dt * (moving ? 2.1 + speed * 1.7 : progress > 0 ? 6 : 0);
    const swing = moving ? Math.sin(this.phase) : 0;
    const working = progress > 0 ? 1 : 0;
    this.carry += ((carrying || working ? 1 : 0) - this.carry) * Math.min(1, dt * 12);
    this.legL.rotation.x = swing * 0.75;
    this.legR.rotation.x = -swing * 0.75;
    const armSwing = swing * 0.7 * (1 - this.carry);
    // busy hands wiggle while a hold-task runs
    const busy = working ? Math.sin(time * 14) * 0.18 : 0;
    this.armL.rotation.x = -armSwing - this.carry * 1.15 + busy;
    this.armR.rotation.x = armSwing - this.carry * 1.15 - busy;
    this.armL.rotation.z = this.carry * 0.12;
    this.armR.rotation.z = this.carry * -0.12;
    this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.06 : Math.sin(time * 2 + this.phase) * 0.012;
    this.body.rotation.z = moving ? Math.sin(this.phase) * 0.05 : 0;
    const arrow = this.marker?.getObjectByName("arrow");
    if (arrow) arrow.position.y = 2.15 + Math.sin(time * 4) * 0.08;
    this.bar.visible = progress > 0;
    if (progress > 0) {
      this.barFill.scale.set(0.92 * progress, 0.1, 1);
      this.barFill.position.set(-0.46 + 0.46 * progress, 0, 0.001);
    }
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.tag?.dispose();
    this.res.disposeAll();
  }
}
