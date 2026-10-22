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
  brownDark: 0x6b3819,
  grey: 0x9aa3b1,
  hair: 0x4a2c1a,
  eye: 0x2a1812,
} as const;

// Soft "vinyl toy" shading: smooth physical material with a faint clearcoat, no hard cel bands.
const mats = new Map<string, THREE.MeshPhysicalMaterial>();
function mat(color: number, roughness = 0.55, coat = 0.25, doubleSided = false) {
  const key = `${color}|${roughness}|${coat}|${doubleSided}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: coat, clearcoatRoughness: 0.45, sheen: 0.2, sheenRoughness: 0.7, sheenColor: new THREE.Color(color), emissive: new THREE.Color(color).multiplyScalar(0.12), side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    mats.set(key, m);
  }
  return m;
}

const boxes = new Map<string, RoundedBoxGeometry>();
function box(w: number, h: number, d: number, r: number) {
  const key = `${w}|${h}|${d}|${r}`;
  let g = boxes.get(key);
  if (!g) boxes.set(key, (g = new RoundedBoxGeometry(w, h, d, 6, r)));
  return g;
}

// ---- smooth profile helpers: body parts are lathed from spline profiles so they flow into each other

type P2 = [number, number]; // [radius, y]
/** Catmull-Rom through the control points, sampled densely for a smooth silhouette. */
function smooth(points: P2[], n = 48) {
  return new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y))).getSpacedPoints(n);
}
/** LatheGeometry faces outward only for a counter-clockwise profile in (r, y); fix the winding either way. */
function outward(pts: THREE.Vector2[]) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? pts.reverse() : pts;
}
function lathe(points: P2[], n = 48, segs = 48, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = smooth(points, n).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  return new THREE.LatheGeometry(outward(pts), segs, phiStart, phiLength);
}
/** Radius of a sampled profile at height y (profile need not be monotonic overall; uses the outermost hit). */
function radiusAt(samples: THREE.Vector2[], y: number) {
  let best = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) best = Math.max(best, a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return best;
}
/** A thin panel that hugs a lathed surface: front sector of a closed profile offset from the body. */
function shellSector(surface: THREE.Vector2[], y0: number, y1: number, inset: number, thick: number, phiHalf: number) {
  const pts: P2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push([radiusAt(surface, y) - inset, y]);
  }
  const top = radiusAt(surface, y1);
  pts.push([top + thick * 0.5, y1 + thick * 0.45]);
  for (let i = steps; i >= 0; i--) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push([radiusAt(surface, y) + thick, y]);
  }
  return new THREE.LatheGeometry(outward(pts.map(([r, y]) => new THREE.Vector2(r, y))), 32, -phiHalf, phiHalf * 2);
}

// ---- shared geometry, built once for every worker

const sphere = new THREE.SphereGeometry(1, 40, 28);
const capsule = new THREE.CapsuleGeometry(1, 1, 8, 16);
const dome = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);

// torso, in world-height units (the torso shape group is offset so these read as heights above the floor)
const OVERALLS_PROFILE: P2[] = [[0, 0.47], [0.17, 0.485], [0.255, 0.535], [0.288, 0.61], [0.296, 0.7], [0.29, 0.82], [0.283, 0.92], [0.28, 0.975], [0.262, 0.99]];
const SHIRT_PROFILE: P2[] = [[0, 0.8], [0.25, 0.82], [0.268, 0.93], [0.283, 1.02], [0.288, 1.08], [0.272, 1.15], [0.215, 1.21], [0.11, 1.245], [0, 1.255]];
const overallsSamples = smooth(OVERALLS_PROFILE, 64);
const shirtSamples = smooth(SHIRT_PROFILE, 64);
const TORSO_DEPTH = 0.78; // elliptical cross-section

const G = {
  overalls: lathe(OVERALLS_PROFILE, 64),
  shirt: lathe(SHIRT_PROFILE, 64),
  bib: shellSector(shirtSamples, 0.93, 1.12, 0.006, 0.016, 0.6),
  pocket: shellSector(shirtSamples, 0.94, 1.03, -0.012, 0.012, 0.3),
  belt: (() => {
    const r = (y: number) => radiusAt(overallsSamples, y);
    return new THREE.LatheGeometry([[r(0.665) - 0.01, 0.665], [r(0.665) + 0.012, 0.667], [r(0.67) + 0.018, 0.675], [r(0.715) + 0.018, 0.715], [r(0.72) + 0.012, 0.723], [r(0.725) - 0.01, 0.725]].map(([a, b]) => new THREE.Vector2(a, b)), 64);
  })(),
  straps: [-1, 1].map((s) => {
    const x = s * 0.15;
    const off = 0.014;
    const zAt = (y: number) => Math.sqrt(Math.max(0, (radiusAt(shirtSamples, y) + off) ** 2 - x * x));
    let topY = 1.1;
    while (topY < 1.26 && zAt(topY + 0.002) > 0.01) topY += 0.002;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const y = 1.1 + ((topY - 1.1) * i) / 6;
      pts.push(new THREE.Vector3(x, y, zAt(y)));
    }
    pts.push(new THREE.Vector3(x, topY + 0.008, 0));
    for (let i = 6; i >= 0; i--) {
      const y = 1.0 + ((topY - 1.0) * i) / 6;
      pts.push(new THREE.Vector3(x, y, -zAt(y)));
    }
    const band = new THREE.Shape();
    band.moveTo(-0.007, -0.036);
    band.lineTo(0.007, -0.036);
    band.lineTo(0.007, 0.036);
    band.lineTo(-0.007, 0.036);
    band.closePath();
    return new THREE.ExtrudeGeometry(band, { steps: 64, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(pts) });
  }),
  // arm, local to a shoulder pivot, hanging along -y
  sleeve: lathe([[0, 0.075], [0.075, 0.066], [0.112, 0.03], [0.124, -0.03], [0.13, -0.09], [0.134, -0.125], [0.124, -0.14], [0.108, -0.13]], 40),
  forearm: lathe([[0, -0.04], [0.06, -0.05], [0.072, -0.09], [0.066, -0.2], [0.062, -0.27], [0, -0.28]], 32, 32),
  cuff: lathe([[0, -0.24], [0.088, -0.238], [0.102, -0.248], [0.112, -0.29], [0.12, -0.335], [0.114, -0.354], [0.09, -0.36], [0, -0.36]], 32, 40),
  // legs, local to a hip pivot
  trouser: lathe([[0, 0.07], [0.12, 0.06], [0.152, 0.0], [0.148, -0.12], [0.14, -0.24], [0.148, -0.32], [0.155, -0.35], [0.135, -0.365], [0, -0.37]], 40),
  bootShaft: lathe([[0, -0.3], [0.128, -0.302], [0.146, -0.32], [0.15, -0.42], [0, -0.43]], 32, 36),
  bootCollar: lathe([[0.13, -0.325], [0.155, -0.322], [0.165, -0.34], [0.158, -0.36], [0.135, -0.358]], 16, 36),
  brim: (() => {
    const outer = new THREE.Shape();
    outer.absellipse(0, -0.065, 0.58, 0.625, 0, Math.PI * 2, false, 0);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.47, 0, Math.PI * 2, true);
    outer.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.016, bevelSegments: 5, curveSegments: 64 });
    g.rotateX(-Math.PI / 2);
    return g;
  })(),
};

type V3 = [number, number, number];
function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0]) {
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
  const grp = () => new THREE.Group();
  const [legL, legR, armL, armR, torso, head, hat] = [grp(), grp(), grp(), grp(), grp(), grp(), grp()];

  const skin = mat(P.skin, 0.5, 0.2);
  const skinShade = mat(P.skinShade, 0.5, 0.1);
  const blue = mat(P.overalls, 0.6, 0.2);
  const blueSheet = mat(P.overalls, 0.6, 0.2, true);
  const blueLight = mat(P.overallsLight, 0.6, 0.2, true);
  const shirt = mat(shirtColor, 0.6, 0.2);
  const shirtSheet = mat(shirtColor, 0.6, 0.2, true);
  const dark = mat(P.dark, 0.5, 0.35);
  const glove = mat(P.glove, 0.55, 0.3);
  const hatM = mat(P.hat, 0.42, 0.18);
  const hatShade = mat(P.hatShade, 0.42, 0.18);
  const hair = mat(P.hair, 0.55, 0.15);
  const brown = mat(P.brown, 0.8, 0);
  const brownDark = mat(P.brownDark, 0.85, 0);
  const grey = mat(P.grey, 0.35, 0.6);

  // legs: tapered trouser with a slight flare over a cuffed boot, rounded toe, chunky treaded sole
  for (const [leg, x] of [[legL, -0.14], [legR, 0.14]] as const) {
    leg.position.set(x, 0.58, 0);
    root.add(leg);
    add(leg, G.trouser, blue);
    add(leg, G.bootShaft, dark);
    add(leg, G.bootCollar, dark);
    add(leg, box(0.28, 0.17, 0.4, 0.085), dark, [0, -0.465, 0.065]);
    add(leg, sphere, dark, [0, -0.47, 0.17], [0.14, 0.1, 0.11]); // toe cap
    add(leg, box(0.3, 0.065, 0.44, 0.03), brown, [0, -0.545, 0.07]);
    for (const z of [-0.08, 0.0, 0.08, 0.16]) add(leg, box(0.306, 0.02, 0.03, 0.008), brownDark, [0, -0.548, z]); // tread
  }

  // torso pivot sits at the waist so the upper body can lean and twist
  torso.position.set(0, 0.7, 0);
  root.add(torso);
  const shape = grp(); // lathed torso, built in floor-height units and squashed into an ellipse
  shape.position.y = -0.7;
  shape.scale.z = TORSO_DEPTH;
  torso.add(shape);
  add(shape, G.shirt, shirt);
  add(shape, G.overalls, blue);
  add(shape, G.bib, blueSheet);
  add(shape, G.pocket, blueLight);
  add(shape, G.belt, dark);
  for (const s of G.straps) add(shape, s, blueSheet);
  const rBib = radiusAt(shirtSamples, 1.1) + 0.03;
  for (const x of [-0.15, 0.15]) add(shape, sphere, dark, [x, 1.1, Math.sqrt(rBib * rBib - x * x)], [0.036, 0.036, 0.03]); // strap buttons
  const rBelt = radiusAt(overallsSamples, 0.695) + 0.03;
  add(shape, box(0.12, 0.075, 0.04, 0.018), grey, [0, 0.695, rBelt]); // buckle

  // arms: the sleeve's dome is sunk into the shoulder so the shirt flows into it; forearm, flared cuff, mitten
  for (const [arm, s] of [[armL, -1], [armR, 1]] as const) {
    arm.position.set(s * 0.285, 1.12 - 0.7, 0);
    torso.add(arm);
    add(arm, G.sleeve, shirtSheet);
    add(arm, G.forearm, skin);
    add(arm, G.cuff, glove, [0, 0, 0], [1.12, 1, 1.12]);
    const hand = grp();
    hand.position.y = -0.455;
    hand.scale.setScalar(1.18);
    arm.add(hand);
    add(hand, box(0.19, 0.18, 0.2, 0.085), dark);
    for (const [i, fx] of [-0.06, -0.02, 0.02, 0.06].entries()) add(hand, capsule, dark, [fx * 0.9, -0.085 + (i % 2) * 0.006, 0.05], [0.034, 0.03, 0.034], [0.5, 0, 0]); // curled fingers
    add(hand, capsule, dark, [-s * 0.085, -0.005, 0.07], [0.042, 0.035, 0.042], [0.35, 0, s * 0.45]); // thumb
    add(hand, box(0.04, 0.11, 0.13, 0.018), glove, [s * 0.095, 0.01, 0]); // back-of-hand patch
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
  add(hat, G.brim, hatShade, [0, -0.03, 0]);
  add(hat, box(0.14, 0.08, 0.7, 0.04), hatM, [0, 0.41, 0]); // centre ridge
  for (const s of [-1, 1]) add(hat, box(0.1, 0.07, 0.62, 0.035), hatM, [s * 0.22, 0.37, 0], [1, 1, 1], [0, 0, s * -0.38]);
  add(hat, box(0.3, 0.2, 0.1, 0.05), hatM, [0, 0.2, 0.47], [1, 1, 1], [-0.25, 0, 0]); // front plate

  return { root, legL, legR, armL, armR, torso, head, hat, eyes };
}
