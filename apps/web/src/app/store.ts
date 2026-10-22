import { useSyncExternalStore } from "react";

export type NetStatus = "idle" | "connecting" | "online" | "offline" | "error";

export interface HudState {
  started: boolean;
  status: NetStatus;
  statusText: string;
  players: number;
  delivered: number;
  target: number;
  round: "playing" | "complete";
  hint: string;
  showHelp: boolean;
  fatal: string;
}

let state: HudState = {
  started: false,
  status: "idle",
  statusText: "",
  players: 1,
  delivered: 0,
  target: 5,
  round: "playing",
  hint: "",
  showHelp: true,
  fatal: "",
};
const listeners = new Set<() => void>();

/** HUD state lives outside React; the game writes to it only when a value actually changes. */
export const hud = {
  get: () => state,
  set(patch: Partial<HudState>) {
    const changed = (Object.keys(patch) as (keyof HudState)[]).some((k) => state[k] !== patch[k]);
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
