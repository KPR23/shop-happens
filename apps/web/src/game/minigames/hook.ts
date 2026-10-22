import type { MinigameKind } from "@shop/shared";
import { hud } from "../../app/store";
import type { Session } from "../session/types";
import { MinigameManager } from "./index";

/** Dev/test triggers until the hold-E interactions call `launch()` themselves. */
const DEBUG_KEYS: Record<string, MinigameKind> = { Digit1: "checkout", Digit2: "unpack" };

export interface MinigameHook {
  /** The single entry point for gameplay code: replaces a hold-E action with `hook.launch("unpack")`. */
  launch(kind: MinigameKind): Promise<boolean>;
  /** Feed key presses; returns true when consumed. */
  onKey(code: string): boolean;
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
    onKey(code) {
      if (manager.active) return true;
      const kind = DEBUG_KEYS[code];
      if (kind && hud.get().started && getSession()) {
        void manager.start(kind);
        return true;
      }
      return false;
    },
    update: (dt) => manager.update(dt),
    get active() {
      return manager.active;
    },
    dispose: () => manager.dispose(),
  };
}
