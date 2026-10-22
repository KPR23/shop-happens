import * as THREE from "three";
import { PLAYER_COLORS } from "@shop/shared";
import { Disposables, textSprite } from "./common";
import { buildWorkerModel } from "./workerModel";

/**
 * Chunky toy-like worker assembled from primitives. Faces +Z at rotation 0.
 * Swap the body for a GLB later by replacing `body` while keeping this class's API.
 */
export class Worker {
  readonly group = new THREE.Group();
  private body: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private marker?: THREE.Group;
  private phase = Math.random() * 6;
  private carry = 0;
  private res = new Disposables();

  constructor(colorIndex: number, name: string, isLocal: boolean) {
    const model = buildWorkerModel(PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]);
    this.legL = model.legL;
    this.legR = model.legR;
    this.armL = model.armL;
    this.armR = model.armR;
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
    if (arrow) arrow.position.y = 2.5 + Math.sin(time * 4) * 0.08;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.res.disposeAll();
  }
}
