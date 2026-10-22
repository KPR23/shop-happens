import type { MinigameKind, MinigameReport, MinigameResult, MinigameSession, MinigameStartResult } from "@shop/shared";
import type { MinigameStage } from "./stage";

/** How a minigame talks to the authority (Colyseus room online, GameSim offline). */
export interface MinigameChannel {
  request(kind: MinigameKind): Promise<MinigameStartResult>;
  complete(report: MinigameReport): Promise<MinigameResult>;
  cancel(): void;
}

/** Small HUD owned by the manager; minigames only push text/numbers into it. */
export interface MinigameUi {
  setCounter(done: number, total: number, label?: string): void;
  setHint(text: string): void;
  flash(text: string, ok?: boolean): void;
}

export interface MinigameContext {
  /** Issued by the server: kind, seed and item count. The game must derive its items from it. */
  session: MinigameSession;
  /** generateItems(seed, count): the product sequence the server expects to see handled. */
  items: number[];
  stage: MinigameStage;
  ui: MinigameUi;
  beep(freq?: number, ms?: number, type?: OscillatorType, gain?: number): void;
  /** Builds the report (session id, kind, elapsed) from what the player actually did. */
  report(handled: number[], actions: number): MinigameReport;
}

/**
 * A minigame owns its own Three.js scene/camera (via ctx.stage) and its own input.
 * To add one (e.g. shelving): implement this, add a kind + config in packages/shared/src/minigames.ts,
 * and register a factory in ./index.ts. The server needs no change beyond the config.
 */
export interface Minigame {
  readonly id: MinigameKind;
  start(ctx: MinigameContext): void;
  update(dt: number): void;
  dispose(): void;
  /** Assigned by the manager; call it once with the final report when the player is done. */
  onComplete?: (report: MinigameReport) => void;
}
