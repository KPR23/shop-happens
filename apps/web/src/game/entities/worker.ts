import * as THREE from "three";
import { PLAYER_COLORS } from "@shop/shared";
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

const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const domeGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);

function part(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number], parent: THREE.Object3D) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/**
 * Chunky toy-like worker assembled from primitives. Faces +Z at rotation 0.
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

  constructor(colorIndex: number, name: string, isLocal: boolean) {
    const shirt = toyMat(PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]);
    const skin = toyMat(SKIN, 0.5);
    const blue = toyMat(OVERALLS);
    this.group.add(this.body);
    const b = this.body;

    // legs + boots
    for (const [leg, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      leg.position.set(x, 0.52, 0);
      b.add(leg);
      part(cylGeo, blue, [0, -0.17, 0], [0.11, 0.34, 0.11], leg);
      part(cylGeo, toyMat(DARK), [0, -0.38, 0.02], [0.13, 0.12, 0.14], leg);
      part(boxGeo, toyMat(DARK), [0, -0.42, 0.06], [0.22, 0.17, 0.32], leg);
      part(boxGeo, toyMat(BROWN), [0, -0.5, 0.06], [0.24, 0.05, 0.34], leg);
    }

    // torso: overalls over an orange shirt
    part(sphereGeo, blue, [0, 0.76, 0], [0.29, 0.27, 0.23], b);
    part(sphereGeo, shirt, [0, 0.98, 0], [0.29, 0.17, 0.22], b);
    part(boxGeo, blue, [0, 0.9, 0.2], [0.3, 0.3, 0.07], b); // bib
    part(boxGeo, toyMat(0x3a78da), [0, 0.86, 0.245], [0.17, 0.1, 0.03], b); // pocket
    for (const x of [-0.12, 0.12]) {
      part(boxGeo, blue, [x, 1.0, 0.16], [0.05, 0.2, 0.05], b); // straps
      part(sphereGeo, toyMat(DARK), [x, 1.03, 0.2], [0.03, 0.03, 0.02], b); // buttons
    }
    part(cylGeo, toyMat(DARK), [0, 0.65, 0], [0.3, 0.07, 0.24], b); // belt
    part(boxGeo, toyMat(GREY), [0, 0.65, 0.235], [0.1, 0.07, 0.025], b);

    // arms with sleeve + green cuffed glove
    for (const [arm, x] of [[this.armL, -0.35], [this.armR, 0.35]] as const) {
      arm.position.set(x, 1.0, 0);
      b.add(arm);
      part(cylGeo, shirt, [0, -0.07, 0], [0.095, 0.16, 0.095], arm);
      part(cylGeo, toyMat(SKIN), [0, -0.19, 0], [0.07, 0.1, 0.07], arm);
      part(cylGeo, toyMat(GLOVE), [0, -0.27, 0], [0.105, 0.09, 0.105], arm);
      part(sphereGeo, toyMat(DARK), [0, -0.38, 0.01], [0.1, 0.1, 0.1], arm);
      part(boxGeo, toyMat(GLOVE), [0, -0.37, 0.07], [0.1, 0.09, 0.03], arm);
    }

    // head: big and round, with ears, eyes, brows, hair and a yellow hard hat
    part(sphereGeo, skin, [0, 1.32, 0], [0.43, 0.4, 0.4], b);
    part(sphereGeo, skin, [-0.42, 1.28, 0], [0.085, 0.1, 0.07], b);
    part(sphereGeo, skin, [0.42, 1.28, 0], [0.085, 0.1, 0.07], b);
    part(sphereGeo, toyMat(HAIR), [0, 1.34, -0.08], [0.42, 0.38, 0.38], b);
    for (const x of [-0.15, 0.15]) {
      part(sphereGeo, toyMat(0x2a1a12, 0.3), [x, 1.28, 0.36], [0.055, 0.075, 0.03], b);
      part(boxGeo, toyMat(HAIR), [x, 1.37, 0.385], [0.13, 0.035, 0.03], b);
    }
    const hat = toyMat(HAT, 0.45);
    part(domeGeo, hat, [0, 1.45, 0], [0.47, 0.43, 0.48], b);
    part(cylGeo, hat, [0, 1.46, 0.07], [0.52, 0.045, 0.55], b);
    part(boxGeo, hat, [0, 1.87, 0.02], [0.12, 0.05, 0.62], b);
    part(boxGeo, hat, [0, 1.65, 0.3], [0.2, 0.17, 0.12], b);

    // name tag, plus a ring and bobbing arrow for the locally controlled worker
    const tag = textSprite(isLocal ? `${name} (you)` : name, { bg: isLocal ? "rgba(255,200,0,0.95)" : "rgba(30,40,70,0.82)", fg: isLocal ? "#2a1a00" : "#fff" });
    tag.sprite.position.set(0, 2.45, 0);
    this.res.add({ dispose: tag.dispose });
    this.group.add(tag.sprite);
    if (isLocal) {
      const m = (this.marker = new THREE.Group());
      const ringGeo = this.res.add(new THREE.RingGeometry(0.62, 0.78, 32));
      const ringMat = this.res.add(new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      const arrowGeo = this.res.add(new THREE.ConeGeometry(0.16, 0.3, 4));
      const arrow = new THREE.Mesh(arrowGeo, ringMat);
      arrow.rotation.x = Math.PI;
      arrow.position.y = 2.15;
      arrow.name = "arrow";
      m.add(ring, arrow);
      this.group.add(m);
    }
  }

  /** x/z world position, rot yaw, speed in units/s, carrying a box, time for idle motion. */
  update(dt: number, x: number, z: number, rot: number, speed: number, carrying: boolean, time: number) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rot;
    const moving = speed > 0.3;
    this.phase += dt * (moving ? 2.1 + speed * 1.7 : 0);
    const swing = moving ? Math.sin(this.phase) : 0;
    this.carry += ((carrying ? 1 : 0) - this.carry) * Math.min(1, dt * 12);
    this.legL.rotation.x = swing * 0.75;
    this.legR.rotation.x = -swing * 0.75;
    const armSwing = swing * 0.7 * (1 - this.carry);
    this.armL.rotation.x = -armSwing - this.carry * 1.15;
    this.armR.rotation.x = armSwing - this.carry * 1.15;
    this.armL.rotation.z = -this.carry * -0.12;
    this.armR.rotation.z = this.carry * -0.12;
    this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.06 : Math.sin(time * 2 + this.phase) * 0.012;
    this.body.rotation.z = moving ? Math.sin(this.phase) * 0.05 : 0;
    const arrow = this.marker?.getObjectByName("arrow");
    if (arrow) arrow.position.y = 2.15 + Math.sin(time * 4) * 0.08;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.res.disposeAll();
  }
}
