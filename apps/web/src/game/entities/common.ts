import * as THREE from "three";

/** Collects GPU resources so a scene or entity can be torn down completely. */
export class Disposables {
  private items: Array<{ dispose(): void }> = [];
  add<T extends { dispose(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }
  disposeAll() {
    this.items.forEach((i) => i.dispose());
    this.items = [];
  }
}

const matCache = new Map<number, THREE.MeshStandardMaterial>();
/** Shared flat-colour toy materials (never disposed individually; they live for the page). */
export function toyMat(color: number, roughness = 0.6): THREE.MeshStandardMaterial {
  const key = color * 10 + Math.round(roughness * 10);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    matCache.set(key, m);
  }
  return m;
}

export function textSprite(text: string, opts: { fg?: string; bg?: string; size?: number; scale?: number } = {}) {
  const { fg = "#fff", bg = "rgba(30,40,70,0.82)", size = 44, scale = 0.012 } = opts;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `800 ${size}px system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w;
  c.height = size + 24;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 18);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 18, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(c.width * scale, c.height * scale, 1);
  sprite.renderOrder = 10;
  return { sprite, dispose: () => (tex.dispose(), mat.dispose()) };
}
