import type { Room } from "@colyseus/sdk";
import { MSG, type GameSim, type MinigameKind, type MinigameReport, type MinigameResult, type MinigameStartResult } from "@shop/shared";
import type { MinigameChannel } from "./types";

/** Offline: the same GameSim validation as the server, just called directly. */
export class LocalMinigameChannel implements MinigameChannel {
  constructor(
    private sim: GameSim,
    private playerId: string,
  ) {}
  request(kind: MinigameKind): Promise<MinigameStartResult> {
    return Promise.resolve(this.sim.startMinigame(this.playerId, kind, performance.now()));
  }
  complete(report: MinigameReport): Promise<MinigameResult> {
    return Promise.resolve(this.sim.completeMinigame(this.playerId, report, performance.now()));
  }
  cancel(): void {
    this.sim.cancelMinigame(this.playerId);
  }
}

const TIMEOUT_MS = 4000;

/** Online: request/response over the room; the server answers each message to this client only. */
export class NetworkMinigameChannel implements MinigameChannel {
  private pendingStart?: (r: MinigameStartResult) => void;
  private pendingResult?: (r: MinigameResult) => void;

  constructor(private room: Room) {
    room.onMessage(MSG.mgSession, (r: MinigameStartResult) => {
      this.pendingStart?.(r);
      this.pendingStart = undefined;
    });
    room.onMessage(MSG.mgResult, (r: MinigameResult) => {
      this.pendingResult?.(r);
      this.pendingResult = undefined;
    });
  }

  private ask<T>(set: (fn: ((r: T) => void) | undefined) => void, send: () => void, timeout: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const t = setTimeout(() => {
        set(undefined);
        resolve(timeout);
      }, TIMEOUT_MS);
      set((r) => {
        clearTimeout(t);
        resolve(r);
      });
      send();
    });
  }

  request(kind: MinigameKind): Promise<MinigameStartResult> {
    return this.ask<MinigameStartResult>((f) => (this.pendingStart = f), () => this.room.send(MSG.mgStart, { kind }), { ok: false, reason: "bad_request" });
  }
  complete(report: MinigameReport): Promise<MinigameResult> {
    return this.ask<MinigameResult>(
      (f) => (this.pendingResult = f),
      () => this.room.send(MSG.mgComplete, report),
      { ok: false, sessionId: report.sessionId, kind: report.kind, reason: "bad_request", reward: 0 },
    );
  }
  cancel(): void {
    this.room.send(MSG.mgCancel, {});
  }
}
