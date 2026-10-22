import { GameSim, type SimEvent } from "@shop/shared";
import type { Session } from "./types";

/** Offline single-player: runs the same rules as the server, in-browser. */
export class LocalSession implements Session {
  readonly localId = "local";
  readonly sim = new GameSim();
  onEvent?: (e: SimEvent) => void;
  onDisconnect?: (reason: string) => void;

  constructor(name: string) {
    this.sim.addPlayer(this.localId, name);
    this.sim.onEvent = (e) => this.onEvent?.(e);
  }
  get view() {
    return this.sim;
  }
  sendMove(x: number, z: number, rot: number) {
    this.sim.move(this.localId, x, z, rot, performance.now());
  }
  pickup(boxId: string) {
    this.sim.pickup(this.localId, boxId);
  }
  put() {
    this.sim.put(this.localId);
  }
  throwBox() {
    this.sim.throwBox(this.localId);
  }
  hold(on: boolean) {
    if (on) this.sim.startHold(this.localId);
    else this.sim.stopHold(this.localId);
  }
  upgrade(id: string) {
    this.sim.buyUpgrade(this.localId, id);
  }
  update(dt: number) {
    this.sim.tick(dt);
  }
  dispose() {
    this.sim.onEvent = undefined;
  }
}
