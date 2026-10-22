import type { MinigameKind } from "@shop/shared";
import { hud } from "../../app/store";
import type { Session } from "../session/types";
import { MinigameManager } from "./index";


export interface MinigameHook {
  /** The single entry point for gameplay code: replaces a hold-E action with `hook.launch("unpack")`. */
  launch(kind: MinigameKind): Promise<boolean>;
  /** Feed key presses; returns true when consumed (always while a minigame is open). */
  onKey(code: string): boolean;
  /** Close the open minigame without a reward (e.g. the server ended the task). */
  cancel(): void;
  update(dt: number): void;
  readonly active: boolean;
  dispose(): void;
}

/** Thin glue between Game and the minigame framework; Game.ts only calls these four methods. */
export function createMinigameHook(container: HTMLElement, getSession: () => Session | null, onOpen: () => void): MinigameHook {
  const manager = new MinigameManager(container, {
    channel: () => getSession()?.minigames ?? null,
    onOpen,
  });
  return {
    launch: (kind) => (hud.get().started ? manager.start(kind) : Promise.resolve(false)),
    onKey: () => manager.active,
    cancel: () => manager.abort(),
    update: (dt) => manager.update(dt),
    get active() {
      return manager.active;
    },
    dispose: () => manager.dispose(),
  };
}
