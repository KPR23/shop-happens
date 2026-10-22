import * as THREE from "three";
import { PLAYER_COLORS } from "@shop/shared";
import { Disposables, textSprite } from "./common";
import { buildWorkerModel, type WorkerModel } from "./workerModel";

/** Frame-rate independent exponential smoothing toward a target. */
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/**
 * Chunky toy-like worker assembled from primitives. Faces +Z at rotation 0.
 * Swap the body for a GLB later by replacing `body` while keeping this class's API.
 */
export class Worker {
  readonly group = new THREE.Group();
  private body: THREE.Group;
  private marker?: THREE.Group;
  private model: WorkerModel;
  private seed = Math.random() * 6;
  private phase = this.seed;
  private carry = 0;
  private speedSm = 0;
  private lastSpeed = 0;
  private accelSm = 0;
  private lastRot = 0;
  private turn = 0;
  private lastBounce = 0;
  private hatKick = 0;
  private blinkIn = 1 + Math.random() * 3;
  private blinkT = 0;
  private res = new Disposables();

  constructor(colorIndex: number, name: string, isLocal: boolean) {
    const model = buildWorkerModel(PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]);
    this.model = model;
    this.body = model.root;
    this.group.add(this.body);

    // name tag, plus a ring and bobbing arrow for the locally controlled worker
    const tag = textSprite(isLocal ? `${name} ★` : name, { bg: isLocal ? "rgba(255,200,0,0.95)" : "rgba(30,40,70,0.82)", fg: isLocal ? "#2a1a00" : "#fff", size: 34, scale: 0.0062 });
    tag.sprite.position.set(0, 2.6, 0);
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
      arrow.position.y = 2.5;
      arrow.name = "arrow";
      m.add(ring, arrow);
      this.group.add(m);
    }
  }

  /** x/z world position, rot yaw, speed in units/s, carrying a box, time for idle motion. */
  update(dt: number, x: number, z: number, rot: number, speed: number, carrying: boolean, time: number) {
    dt = Math.max(dt, 1e-4);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rot;
    const m = this.model;

    // smoothed motion signals: walk blend, acceleration and turn rate drive every secondary motion
    this.speedSm = damp(this.speedSm, speed, 10, dt);
    const walk = THREE.MathUtils.smoothstep(this.speedSm, 0.2, 2.2);
    const accel = THREE.MathUtils.clamp((speed - this.lastSpeed) / dt / 40, -1, 1);
    this.lastSpeed = speed;
    this.accelSm = damp(this.accelSm, accel, 8, dt);
    const dRot = Math.atan2(Math.sin(rot - this.lastRot), Math.cos(rot - this.lastRot)) / dt;
    this.lastRot = rot;
    this.turn = damp(this.turn, THREE.MathUtils.clamp(dRot / 8, -1, 1), 9, dt);
    this.carry = damp(this.carry, carrying ? 1 : 0, 9, dt);

    this.phase += dt * walk * (5.5 + this.speedSm * 0.9);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const stepBeat = Math.abs(s);

    // legs: swing with a small foot lift, settling back to neutral smoothly when stopping
    m.legL.rotation.x = s * 0.78 * walk;
    m.legR.rotation.x = -s * 0.78 * walk;
    m.legL.position.y = 0.58 + Math.max(0, -c) * 0.07 * walk;
    m.legR.position.y = 0.58 + Math.max(0, c) * 0.07 * walk;

    // body: bounce on each step, squash and stretch, gentle breathing and weight shift when idle
    const breath = Math.sin(time * 2.2 + this.seed);
    const bounce = stepBeat * 0.075 * walk;
    this.body.position.y = bounce + (1 - walk) * breath * 0.008;
    this.body.scale.set(1 + (0.03 * (1 - stepBeat)) * walk, 1 - 0.035 * (1 - stepBeat) * walk + breath * 0.006 * (1 - walk), 1 + (0.03 * (1 - stepBeat)) * walk);
    this.body.rotation.z = c * 0.04 * walk + Math.sin(time * 0.9 + this.seed) * 0.012 * (1 - walk);

    // torso: lean into the run, counter-twist against the legs, lag on acceleration and turns
    const lean = 0.1 * walk + this.accelSm * 0.22;
    m.torso.rotation.x = damp(m.torso.rotation.x, lean + s * 0.02 * walk, 14, dt);
    m.torso.rotation.y = damp(m.torso.rotation.y, -s * 0.16 * walk - this.turn * 0.22, 12, dt);
    m.torso.rotation.z = damp(m.torso.rotation.z, this.turn * 0.07, 10, dt);

    // head: follows the torso a beat late, nods with each step; hat lags the head for secondary motion
    const headX = -lean * 0.55 + Math.sin(this.phase * 2) * 0.03 * walk + Math.sin(time * 1.3 + this.seed) * 0.02 * (1 - walk);
    m.head.rotation.x = damp(m.head.rotation.x, headX, 9, dt);
    m.head.rotation.y = damp(m.head.rotation.y, s * 0.1 * walk + this.turn * 0.2, 8, dt);
    m.head.rotation.z = damp(m.head.rotation.z, -this.turn * 0.05 + Math.sin(time * 0.7 + this.seed) * 0.015 * (1 - walk), 8, dt);
    m.head.position.y = 1.28 + Math.sin(this.phase * 2 + 0.6) * 0.012 * walk;
    this.hatKick += (-(bounce - this.lastBounce) * 4 - this.accelSm * 0.2 - this.hatKick) * Math.min(1, dt * 18);
    this.lastBounce = bounce;
    m.hat.rotation.x = damp(m.hat.rotation.x, this.hatKick * 0.5, 14, dt);
    m.hat.position.y = 1.7 - 1.28 + Math.max(0, this.hatKick) * 0.02;

    // arms: opposite swing to the legs, easing into the two-handed carry pose
    const swing = -s * 0.75 * walk * (1 - this.carry);
    const idleSway = Math.sin(time * 1.6 + this.seed) * 0.04 * (1 - walk) * (1 - this.carry);
    const armL = swing + idleSway - this.carry * 1.2;
    const armR = -swing - idleSway - this.carry * 1.2;
    m.armL.rotation.x = damp(m.armL.rotation.x, armL, 16, dt);
    m.armR.rotation.x = damp(m.armR.rotation.x, armR, 16, dt);
    m.armL.rotation.z = damp(m.armL.rotation.z, 0.06 + walk * 0.05 - this.carry * 0.14, 12, dt);
    m.armR.rotation.z = damp(m.armR.rotation.z, -0.06 - walk * 0.05 + this.carry * 0.14, 12, dt);

    // blink every few seconds
    this.blinkIn -= dt;
    if (this.blinkIn < 0) {
      this.blinkT = 0.16;
      this.blinkIn = 2.2 + Math.random() * 3.2;
    }
    this.blinkT = Math.max(0, this.blinkT - dt);
    const lid = this.blinkT > 0 ? Math.abs(this.blinkT / 0.16 - 0.5) * 2 : 1;
    for (const e of m.eyes) e.scale.y = 0.1 * Math.max(0.08, lid);

    const arrow = this.marker?.getObjectByName("arrow");
    if (arrow) arrow.position.y = 2.5 + Math.sin(time * 4) * 0.08;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.res.disposeAll();
  }
}
