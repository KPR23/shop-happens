const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Keyboard state. Ignores keys while the player is typing in a form field. */
export class Input {
  private down = new Set<string>();
  onPress?: (code: string) => void;

  private keydown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    if (!e.repeat) this.onPress?.(e.code);
    this.down.add(e.code);
  };
  private keyup = (e: KeyboardEvent) => this.down.delete(e.code);
  private blur = () => this.down.clear();

  constructor() {
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("blur", this.blur);
  }

  /** Screen-relative axes: +x right, +z toward the camera (S). Camera yaw is 0, so these are world axes. */
  axis() {
    const h = (this.down.has("KeyD") || this.down.has("ArrowRight") ? 1 : 0) - (this.down.has("KeyA") || this.down.has("ArrowLeft") ? 1 : 0);
    const v = (this.down.has("KeyS") || this.down.has("ArrowDown") ? 1 : 0) - (this.down.has("KeyW") || this.down.has("ArrowUp") ? 1 : 0);
    return { x: h, z: v };
  }

  clear() {
    this.down.clear();
  }

  dispose() {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("blur", this.blur);
  }
}
