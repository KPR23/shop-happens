import { useSyncExternalStore } from "react";
import type { DayPhase, Upgrades } from "@shop/shared";

export type NetStatus = "idle" | "connecting" | "online" | "offline" | "error";

export interface HudState {
  started: boolean;
  status: NetStatus;
  statusText: string;
  players: number;
  money: number;
  day: number;
  phase: DayPhase;
  /** Whole seconds left in the phase. */
  phaseLeft: number;
  /** Clock as "HH:MM". */
  clock: string;
  earned: number;
  served: number;
  lost: number;
  upgrades: Upgrades;
  hint: string;
  /** Hold-task of the local worker: label and progress 0..1 (empty label = none). */
  taskLabel: string;
  taskProgress: number;
  /** Seconds left on the local worker's wholesaler trip, 0 if not away. */
  awayLeft: number;
  toast: { id: number; text: string } | null;
  showHelp: boolean;
  fatal: string;
}

let state: HudState = {
  started: false,
  status: "idle",
  statusText: "",
  players: 1,
  money: 0,
  day: 1,
  phase: "prep",
  phaseLeft: 0,
  clock: "07:00",
  earned: 0,
  served: 0,
  lost: 0,
  upgrades: { hands: 0, deal: 0, traffic: 0 },
  hint: "",
  taskLabel: "",
  taskProgress: 0,
  awayLeft: 0,
  toast: null,
  showHelp: true,
  fatal: "",
};
const listeners = new Set<() => void>();

/** HUD state lives outside React; the game writes to it only when a value actually changes. */
export const hud = {
  get: () => state,
  set(patch: Partial<HudState>) {
    const changed = (Object.keys(patch) as (keyof HudState)[]).some((k) => {
      const a = state[k];
      const b = patch[k];
      return k === "upgrades" ? JSON.stringify(a) !== JSON.stringify(b) : a !== b;
    });
    if (!changed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useHud = () => useSyncExternalStore(hud.subscribe, hud.get);
