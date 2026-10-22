import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Palette sampled from the worker character sheet. */
export const WORKER_PALETTE = {
  skin: 0xf6c4a0,
  skinShade: 0xe9a782,
  hat: 0xffc90e,
  hatShade: 0xf2b200,
  shirt: 0xf5791f,
  overalls: 0x2c6bd0,
  overallsLight: 0x3a7be0,
  glove: 0x3f9142,
  dark: 0x35383b,
  brown: 0x8a4b25,
  grey: 0x9aa3b1,
  hair: 0x4a2c1a,
  eye: 0x2a1812,
} as const;

// Three-step ramp gives the soft, cel-shaded "vinyl toy" look without hard edges.
let ramp: THREE.DataTexture | undefined;
function gradientMap() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([150, 205, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}

const mats = new Map<number, THREE.MeshToonMaterial>();
function toon(color: number) {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() })));
  return m;
}

const sphere = new THREE.SphereGeometry(1, 28, 20);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 20);
const dome = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);

const boxes = new Map<string, RoundedBoxGeometry>();
function box(w: number, h: number, d: number, r: number) {
  const key = `${w}|${h}|${d}|${r}`;
  let g = boxes.get(key);
  if (!g) boxes.set(key, (g = new RoundedBoxGeometry(w, h, d, 3, r)));
  return g;
}

type V3 = [number, number, number];
function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, toon(color));
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export interface WorkerModel {
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
}

/** Builds the worker (faces +Z, ~1.9 units tall). Shared geometry/materials live for the page. */
export function buildWorkerModel(shirtColor: number = WORKER_PALETTE.shirt): WorkerModel {
  const P = WORKER_PALETTE;
  const root = new THREE.Group();
  const [legL, legR, armL, armR] = [0, 1, 2, 3].map(() => new THREE.Group()) as [THREE.Group, THREE.Group, THREE.Group, THREE.Group];

  // legs: blue trouser, dark boot with a rolled cuff, chunky brown sole
  const trouser = box(0.26, 0.4, 0.27, 0.1);
  const cuff = box(0.3, 0.1, 0.31, 0.04);
  const boot = box(0.29, 0.2, 0.42, 0.09);
  const sole = box(0.31, 0.07, 0.45, 0.03);
  for (const [leg, x] of [[legL, -0.15], [legR, 0.15]] as const) {
    leg.position.set(x, 0.56, 0);
    root.add(leg);
    add(leg, trouser, P.overalls, [0, -0.17, 0]);
    add(leg, cuff, P.dark, [0, -0.36, 0.0]);
    add(leg, boot, P.dark, [0, -0.46, 0.07]);
    add(leg, sole, P.brown, [0, -0.53, 0.075]);
  }

  // torso: orange shirt under rounded blue overalls
  add(root, box(0.62, 0.46, 0.42, 0.16), shirtColor, [0, 0.98, 0]);
  add(root, box(0.56, 0.42, 0.4, 0.14), P.overalls, [0, 0.78, 0]);
  add(root, box(0.46, 0.34, 0.07, 0.07), P.overalls, [0, 0.96, 0.2]); // bib
  add(root, box(0.22, 0.13, 0.05, 0.05), P.overallsLight, [0, 0.9, 0.245]); // pocket
  add(root, box(0.2, 0.025, 0.02, 0.01), P.overalls, [0, 0.955, 0.275]); // pocket flap seam
  for (const x of [-0.17, 0.17]) {
    add(root, box(0.075, 0.3, 0.06, 0.03), P.overalls, [x, 1.08, 0.19], [1, 1, 1], [0.12, 0, 0]); // front straps
    add(root, box(0.075, 0.3, 0.06, 0.03), P.overalls, [x, 1.08, -0.19], [1, 1, 1], [-0.12, 0, 0]); // back straps
    add(root, sphere, P.dark, [x, 1.0, 0.235], [0.04, 0.04, 0.02]); // buttons
  }
  add(root, box(0.6, 0.09, 0.44, 0.04), P.dark, [0, 0.7, 0]); // belt
  add(root, box(0.13, 0.09, 0.03, 0.02), P.grey, [0, 0.7, 0.225]); // buckle
  add(root, box(0.5, 0.2, 0.34, 0.1), P.overalls, [0, 0.6, 0]); // hips

  // arms: short sleeve, skin, green cuff, dark glove fist with a green back patch
  const sleeve = box(0.2, 0.2, 0.2, 0.08);
  const forearm = cyl;
  const glove = box(0.19, 0.19, 0.2, 0.08);
  for (const [arm, x] of [[armL, -0.41], [armR, 0.41]] as const) {
    arm.position.set(x, 1.1, 0);
    root.add(arm);
    add(arm, sleeve, shirtColor, [0, -0.08, 0]);
    add(arm, forearm, P.skin, [0, -0.22, 0], [0.065, 0.1, 0.065]);
    add(arm, cyl, P.glove, [0, -0.31, 0], [0.12, 0.07, 0.12]);
    add(arm, glove, P.dark, [0, -0.44, 0.015]);
    add(arm, box(0.16, 0.12, 0.05, 0.04), P.glove, [0, -0.43, 0.115]);
  }

  // head: big, round, soft
  add(root, sphere, P.skin, [0, 1.5, 0.02], [0.46, 0.42, 0.42]);
  add(root, sphere, P.hair, [0, 1.5, -0.12], [0.45, 0.42, 0.36]);
  for (const s of [-1, 1]) {
    add(root, sphere, P.skin, [s * 0.45, 1.44, 0.02], [0.09, 0.12, 0.08]); // ear
    add(root, sphere, P.skinShade, [s * 0.46, 1.44, 0.035], [0.05, 0.075, 0.04]);
    add(root, sphere, P.hair, [s * 0.38, 1.56, 0.12], [0.07, 0.18, 0.1]); // sideburn
    add(root, sphere, P.eye, [s * 0.17, 1.44, 0.4], [0.065, 0.095, 0.035]); // eye
    add(root, sphere, 0xffffff, [s * 0.185, 1.475, 0.43], [0.02, 0.025, 0.012]); // eye shine
    add(root, box(0.2, 0.05, 0.05, 0.02), P.hair, [s * 0.17, 1.565, 0.41], [1, 1, 1], [0, 0, s * -0.1]); // brow
    add(root, sphere, 0xf09a85, [s * 0.27, 1.34, 0.34], [0.07, 0.04, 0.02]); // blush
  }
  add(root, sphere, P.skinShade, [0, 1.38, 0.43], [0.045, 0.035, 0.035]); // nose

  // hard hat: dome, three ridges, front plate and a wide rounded brim
  add(root, dome, P.hat, [0, 1.7, 0], [0.5, 0.42, 0.5]);
  add(root, cyl, P.hat, [0, 1.7, 0.04], [0.54, 0.045, 0.55]); // rim
  add(root, cyl, P.hatShade, [0, 1.69, 0.06], [0.58, 0.03, 0.58]); // brim, pushed forward
  add(root, box(0.14, 0.08, 0.7, 0.04), P.hat, [0, 2.11, 0]); // centre ridge
  for (const s of [-1, 1]) add(root, box(0.1, 0.07, 0.62, 0.035), P.hat, [s * 0.22, 2.07, 0], [1, 1, 1], [0, 0, s * -0.38]);
  add(root, box(0.3, 0.2, 0.1, 0.05), P.hat, [0, 1.9, 0.47], [1, 1, 1], [-0.25, 0, 0]); // front plate

  return { root, legL, legR, armL, armR };
}
