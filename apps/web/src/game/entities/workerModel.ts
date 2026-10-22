import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Palette sampled from the worker character sheet. */
export const WORKER_PALETTE = {
  skin: 0xf7c3a0,
  skinShade: 0xe8a07f,
  blush: 0xf29a82,
  hat: 0xffc90e,
  hatShade: 0xf0ae00,
  shirt: 0xf5791f,
  overalls: 0x2a68cf,
  overallsLight: 0x3a7be0,
  glove: 0x3f9142,
  dark: 0x35383b,
  brown: 0x8a4b25,
  grey: 0x9aa3b1,
  hair: 0x4a2c1a,
  eye: 0x2a1812,
} as const;

// Soft "vinyl toy" shading: smooth physical material with a faint clearcoat, no hard cel bands.
const mats = new Map<string, THREE.MeshPhysicalMaterial>();
function mat(color: number, roughness = 0.55, coat = 0.25) {
  const key = `${color}|${roughness}|${coat}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: coat, clearcoatRoughness: 0.45, sheen: 0.2, sheenRoughness: 0.7, sheenColor: new THREE.Color(color), emissive: new THREE.Color(color).multiplyScalar(0.12) });
    mats.set(key, m);
  }
  return m;
}

const sphere = new THREE.SphereGeometry(1, 40, 28);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 32);
const dome = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
// front arc of a flat ring: the hat visor
const visor = new THREE.CylinderGeometry(1, 1, 1, 40, 1, false, -1.15, 2.3);

const boxes = new Map<string, RoundedBoxGeometry>();
function box(w: number, h: number, d: number, r: number) {
  const key = `${w}|${h}|${d}|${r}`;
  let g = boxes.get(key);
  if (!g) boxes.set(key, (g = new RoundedBoxGeometry(w, h, d, 6, r)));
  return g;
}

type V3 = [number, number, number];
function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...pos);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export interface WorkerModel {
  root: THREE.Group;
  /** leg/arm pivots swing around x; torso and head are separate pivots for secondary motion. */
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hat: THREE.Group;
  eyes: THREE.Mesh[];
}

/** Builds the worker (faces +Z, ~2 units tall). Shared geometry/materials live for the page. */
export function buildWorkerModel(shirtColor: number = WORKER_PALETTE.shirt): WorkerModel {
  const P = WORKER_PALETTE;
  const root = new THREE.Group();
  const g4 = () => new THREE.Group();
  const [legL, legR, armL, armR, torso, head, hat] = [g4(), g4(), g4(), g4(), g4(), g4(), g4()];

  const skin = mat(P.skin, 0.5, 0.2);
  const skinShade = mat(P.skinShade, 0.5, 0.1);
  const blue = mat(P.overalls, 0.6, 0.2);
  const blueLight = mat(P.overallsLight, 0.6, 0.2);
  const shirt = mat(shirtColor, 0.6, 0.2);
  const dark = mat(P.dark, 0.5, 0.35);
  const glove = mat(P.glove, 0.55, 0.3);
  const hatM = mat(P.hat, 0.42, 0.18);
  const hatShade = mat(P.hatShade, 0.42, 0.18);
  const hair = mat(P.hair, 0.55, 0.15);
  const brown = mat(P.brown, 0.8, 0);
  const grey = mat(P.grey, 0.35, 0.6);

  // legs: trouser, rolled dark boot cuff, rounded boot toe, tread sole with a heel step
  for (const [leg, x] of [[legL, -0.15], [legR, 0.15]] as const) {
    leg.position.set(x, 0.58, 0);
    root.add(leg);
    add(leg, box(0.27, 0.42, 0.28, 0.12), blue, [0, -0.17, 0]);
    add(leg, box(0.31, 0.11, 0.32, 0.05), dark, [0, -0.37, 0]);
    add(leg, box(0.3, 0.22, 0.44, 0.11), dark, [0, -0.47, 0.07]);
    add(leg, box(0.325, 0.08, 0.47, 0.035), brown, [0, -0.55, 0.075]);
    add(leg, box(0.33, 0.07, 0.12, 0.03), brown, [0, -0.52, -0.1]); // heel
  }

  // torso pivot sits at the waist so the upper body can lean and twist
  torso.position.set(0, 0.7, 0);
  root.add(torso);
  const T = (y: number) => y - 0.7;
  add(torso, box(0.64, 0.5, 0.44, 0.18), shirt, [0, T(1.0), 0]);
  add(torso, box(0.58, 0.42, 0.42, 0.15), blue, [0, T(0.78), 0]);
  add(torso, box(0.52, 0.5, 0.075, 0.05), blue, [0, T(0.98), 0.205]); // bib
  add(torso, box(0.25, 0.14, 0.05, 0.05), blueLight, [0, T(0.9), 0.245]); // pocket
  add(torso, box(0.22, 0.03, 0.025, 0.012), blue, [0, T(0.955), 0.275]);
  for (const x of [-0.18, 0.18]) {
    add(torso, box(0.08, 0.34, 0.06, 0.03), blue, [x, T(1.1), 0.205], [1, 1, 1], [0.1, 0, 0]); // straps
    add(torso, box(0.08, 0.34, 0.06, 0.03), blue, [x, T(1.1), -0.205], [1, 1, 1], [-0.1, 0, 0]);
    add(torso, sphere, dark, [x, T(1.02), 0.245], [0.042, 0.042, 0.02]); // buttons
  }
  add(torso, box(0.62, 0.09, 0.46, 0.04), dark, [0, T(0.7), 0]); // belt
  add(torso, box(0.13, 0.085, 0.03, 0.02), grey, [0, T(0.7), 0.235]); // buckle
  add(torso, box(0.5, 0.2, 0.34, 0.1), blue, [0, T(0.6), 0]); // hips blend

  // arms: sleeve, skin, green cuff, big dark mitten with thumb and cuff patch
  for (const [arm, s] of [[armL, -1], [armR, 1]] as const) {
    arm.position.set(s * 0.42, T(1.14), 0);
    torso.add(arm);
    add(arm, sphere, shirt, [0, -0.07, 0], [0.12, 0.13, 0.12]);
    add(arm, cyl, skin, [0, -0.22, 0], [0.068, 0.1, 0.068]);
    add(arm, cyl, glove, [0, -0.32, 0], [0.125, 0.075, 0.125]);
    add(arm, box(0.2, 0.2, 0.2, 0.09), dark, [0, -0.45, 0.01]);
    add(arm, box(0.17, 0.12, 0.05, 0.04), glove, [0, -0.44, 0.115]);
    add(arm, sphere, dark, [s * -0.1, -0.44, 0.07], [0.06, 0.09, 0.07]); // thumb
  }

  // head pivots at the neck: big and soft, with ears, eyes, brows, hair and hat on top
  head.position.set(0, 1.28, 0);
  root.add(head);
  const H = (y: number) => y - 1.28;
  add(head, sphere, hair, [0, H(1.53), -0.15], [0.43, 0.42, 0.36]);
  add(head, sphere, skin, [0, H(1.5), 0.03], [0.47, 0.43, 0.42]);
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    add(head, sphere, skin, [s * 0.46, H(1.45), 0.02], [0.095, 0.125, 0.085]); // ear
    add(head, sphere, skinShade, [s * 0.47, H(1.45), 0.04], [0.05, 0.08, 0.04]);
    add(head, sphere, hair, [s * 0.39, H(1.58), 0.1], [0.075, 0.2, 0.12]); // sideburn
    const eye = add(head, sphere, mat(P.eye, 0.25, 0.8), [s * 0.17, H(1.45), 0.405], [0.068, 0.1, 0.035]);
    eyes.push(eye);
    add(head, sphere, mat(0xffffff, 0.2, 0), [s * 0.19, H(1.48), 0.435], [0.02, 0.026, 0.012]); // shine
    add(head, box(0.2, 0.05, 0.05, 0.022), hair, [s * 0.17, H(1.565), 0.415], [1, 1, 1], [0, 0, s * -0.12]); // brow
    add(head, sphere, mat(P.blush, 0.6, 0), [s * 0.28, H(1.35), 0.35], [0.075, 0.042, 0.02]); // blush
  }
  add(head, sphere, skinShade, [0, H(1.39), 0.445], [0.045, 0.035, 0.035]); // nose

  // hard hat as its own pivot so it can lag the head a little
  hat.position.set(0, H(1.7), 0);
  head.add(hat);
  add(hat, dome, hatM, [0, 0, 0], [0.5, 0.42, 0.5]);
  add(hat, cyl, hatM, [0, 0, 0.03], [0.53, 0.045, 0.55]); // rim
  add(hat, visor, hatShade, [0, -0.012, 0.05], [0.62, 0.03, 0.66]); // front visor
  add(hat, box(0.14, 0.08, 0.7, 0.04), hatM, [0, 0.41, 0]); // centre ridge
  for (const s of [-1, 1]) add(hat, box(0.1, 0.07, 0.62, 0.035), hatM, [s * 0.22, 0.37, 0], [1, 1, 1], [0, 0, s * -0.38]);
  add(hat, box(0.3, 0.2, 0.1, 0.05), hatM, [0, 0.2, 0.47], [1, 1, 1], [-0.25, 0, 0]); // front plate

  return { root, legL, legR, armL, armR, torso, head, hat, eyes };
}
