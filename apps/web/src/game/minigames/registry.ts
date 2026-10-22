import type { MinigameKind } from "@shop/shared";
import type { Minigame } from "./types";

type Factory = () => Minigame;
const factories = new Map<MinigameKind, Factory>();

export function registerMinigame(kind: MinigameKind, factory: Factory): void {
  factories.set(kind, factory);
}
export function createMinigame(kind: MinigameKind): Minigame | null {
  return factories.get(kind)?.() ?? null;
}
export function registeredMinigames(): MinigameKind[] {
  return [...factories.keys()];
}
