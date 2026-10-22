import { generateItems, type MinigameFailReason, type MinigameKind, type MinigameReport } from "@shop/shared";
import { beep } from "./audio";
import { createMinigame } from "./registry";
import { MinigameStage } from "./stage";
import type { Minigame, MinigameChannel, MinigameUi } from "./types";
import "./minigames.css";

const TITLES: Record<MinigameKind, string> = { checkout: "Checkout", unpack: "Unpacking" };
const REASONS: Record<MinigameFailReason, string> = {
  bad_request: "The server could not process that request.",
  cooldown: "Slow down a little, then try again.",
  no_session: "That session is no longer valid.",
  wrong_session: "That session is no longer valid.",
  wrong_kind: "Wrong minigame.",
  expired: "The session expired.",
  bad_items: "The server did not accept the items you handled.",
  too_few_actions: "Too few actions were recorded.",
  too_fast: "Suspiciously fast. The server did not accept it.",
  no_station: "Not at the station",
  no_player: "You are not in the shop.",
};

export interface MinigameHooks {
  channel(): MinigameChannel | null;
  /** Called when a minigame opens (release held keys, pause the world). */
  onOpen?(): void;
  /** Called after it closes, with the server-granted reward (0 when cancelled or rejected). */
  onClose?(reward: number): void;
}

/**
 * Owns the overlay, the lifecycle (open, Esc to cancel, submit, result) and the channel round-trips.
 * One minigame at a time. Rewards come back only from the server's validation result.
 */
export class MinigameManager {
  private root: HTMLElement | null = null;
  private stage: MinigameStage | null = null;
  private game: Minigame | null = null;
  private channel: MinigameChannel | null = null;
  private opening = false;
  private submitting = false;
  private token = 0;
  private resultTimer = 0;
  private resultShown = false;
  private el: { counter?: HTMLElement; hint?: HTMLElement; flash?: HTMLElement } = {};
  private flashTimer = 0;

  constructor(
    private container: HTMLElement,
    private hooks: MinigameHooks,
  ) {
    // capture on document so Esc/keys never reach the world's input while a minigame is open
    document.addEventListener("keydown", this.keydown, true);
  }

  get active(): boolean {
    return this.opening || this.root !== null;
  }

  async start(kind: MinigameKind): Promise<boolean> {
    const channel = this.hooks.channel();
    if (this.active || !channel) return false;
    this.opening = true;
    const token = ++this.token;
    const res = await channel.request(kind);
    if (token !== this.token) return false;
    this.opening = false;
    if (!res.ok) return false;
    const game = createMinigame(kind);
    if (!game) {
      channel.cancel();
      return false;
    }

    this.channel = channel;
    this.hooks.onOpen?.();
    this.buildOverlay(kind);
    const stage = new MinigameStage(this.root!.querySelector<HTMLElement>(".mg-view")!);
    this.stage = stage;
    this.game = game;
    const session = res.session;
    const started = performance.now();
    const ui: MinigameUi = {
      setCounter: (done, total, label = "Done") => this.el.counter && (this.el.counter.textContent = `${label}: ${done}/${total}`),
      setHint: (t) => this.el.hint && (this.el.hint.textContent = t),
      flash: (t, ok = true) => this.flash(t, ok),
    };
    game.onComplete = (report) => void this.submit(report, token);
    game.start({
      session,
      items: generateItems(session.seed, session.count),
      stage,
      ui,
      beep: (f, ms, type, gain) => beep(f, ms, type, gain),
      report: (handled, actions): MinigameReport => ({
        sessionId: session.id,
        kind: session.kind,
        items: handled,
        actions,
        clientDurationMs: Math.round(performance.now() - started),
      }),
    });
    return true;
  }

  update(dt: number) {
    if (!this.game || !this.stage) return;
    if (!this.submitting) this.game.update(dt);
    this.stage.render();
  }

  /** Server ended the task: close unless a result is already being submitted or shown. */
  abort() {
    if (this.resultShown || this.submitting) return;
    this.cancel();
  }

  /** Esc: abandon the session without any reward. */
  cancel() {
    if (this.resultShown) return this.close(0);
    if (!this.game) {
      this.token++; // abort a pending start
      this.opening = false;
      return;
    }
    this.channel?.cancel();
    this.close(0);
  }

  private async submit(report: MinigameReport, token: number) {
    if (this.submitting || token !== this.token || !this.channel) return;
    this.submitting = true;
    if (this.el.hint) this.el.hint.textContent = "Checking with the server…";
    const res = await this.channel.complete(report);
    if (token !== this.token) return;
    if (res.ok) beep(1046, 160, "triangle", 0.1);
    else beep(160, 220, "sawtooth");
    this.showResult(res.ok ? `Done! +${res.reward} points` : `Not accepted. ${REASONS[res.reason] ?? ""}`, res.ok, res.ok ? res.reward : 0);
  }

  private showResult(text: string, ok: boolean, reward: number) {
    if (!this.root) return;
    this.resultShown = true;
    const box = document.createElement("div");
    box.className = `mg-result ${ok ? "ok" : "bad"}`;
    const b = document.createElement("b");
    b.textContent = text;
    const s = document.createElement("span");
    s.textContent = "Click or press Esc to continue";
    box.append(b, s);
    box.addEventListener("click", () => this.close(reward));
    this.root.appendChild(box);
    this.resultTimer = window.setTimeout(() => this.close(reward), 2500);
  }

  private buildOverlay(kind: MinigameKind) {
    const root = document.createElement("div");
    root.className = "mg-overlay";
    root.dataset.minigame = kind;
    const view = document.createElement("div");
    view.className = "mg-view";
    const top = document.createElement("div");
    top.className = "mg-top";
    const title = document.createElement("div");
    title.className = "mg-title";
    title.textContent = TITLES[kind];
    const counter = document.createElement("div");
    counter.className = "mg-counter";
    const esc = document.createElement("div");
    esc.className = "mg-esc";
    esc.textContent = "Esc — cancel";
    top.append(title, counter, esc);
    const hint = document.createElement("div");
    hint.className = "mg-hint";
    const flash = document.createElement("div");
    flash.className = "mg-flash";
    root.append(view, top, hint, flash);
    this.container.appendChild(root);
    this.root = root;
    this.el = { counter, hint, flash };
  }

  private flash(text: string, ok: boolean) {
    const f = this.el.flash;
    if (!f) return;
    f.textContent = text;
    f.className = `mg-flash show ${ok ? "ok" : "bad"}`;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (f.className = "mg-flash"), 900);
  }

  private close(reward: number) {
    this.token++;
    clearTimeout(this.resultTimer);
    clearTimeout(this.flashTimer);
    this.game?.dispose();
    this.stage?.dispose();
    this.root?.remove();
    this.game = null;
    this.stage = null;
    this.root = null;
    this.channel = null;
    this.el = {};
    this.submitting = false;
    this.resultShown = false;
    this.opening = false;
    this.hooks.onClose?.(reward);
  }

  private keydown = (e: KeyboardEvent) => {
    if (!this.active) return;
    e.stopPropagation(); // the world must not react to keys while the minigame is up
    if (e.code === "Escape" && !e.repeat) {
      e.preventDefault();
      this.cancel();
    }
  };

  dispose() {
    document.removeEventListener("keydown", this.keydown, true);
    if (this.game) this.channel?.cancel();
    this.close(0);
  }
}
