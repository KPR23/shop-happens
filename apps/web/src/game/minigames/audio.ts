let ctx: AudioContext | undefined;

/** Short synthesized beep (scanner, pop). Audio is optional, so every failure is swallowed. */
export function beep(freq = 1760, ms = 90, type: OscillatorType = "square", gain = 0.07): void {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  } catch {
    /* ignore */
  }
}
