import * as THREE from "three";

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

/**
 * A separate renderer + scene + camera for one minigame, living in an overlay canvas.
 * The main game keeps its own renderer untouched; this one is created on open and disposed on close.
 */
export class MinigameStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
  readonly renderer: THREE.WebGLRenderer;
  /** Pointer in normalised device coordinates, updated before every callback. */
  readonly ndc = new THREE.Vector2();
  /** Pointer in CSS pixels relative to the canvas. */
  readonly px = new THREE.Vector2();
  down = false;
  onDown?: () => void;
  onMove?: () => void;
  onUp?: () => void;

  private ray = new THREE.Raycaster();
  private ro: ResizeObserver;
  private canvas: HTMLCanvasElement;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    const lowfx = new URLSearchParams(location.search).has("lowfx");
    this.renderer.setPixelRatio(lowfx ? 0.6 : Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "mg-canvas";
    host.appendChild(this.canvas);

    this.canvas.addEventListener("pointerdown", this.pd);
    this.canvas.addEventListener("pointermove", this.pm);
    this.canvas.addEventListener("pointerup", this.pu);
    this.canvas.addEventListener("pointercancel", this.pu);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  private track(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.px.set(e.clientX - r.left, e.clientY - r.top);
    this.ndc.set((this.px.x / Math.max(1, r.width)) * 2 - 1, -(this.px.y / Math.max(1, r.height)) * 2 + 1);
  }
  private pd = (e: PointerEvent) => {
    this.track(e);
    this.down = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    this.onDown?.();
  };
  private pm = (e: PointerEvent) => {
    this.track(e);
    this.onMove?.();
  };
  private pu = (e: PointerEvent) => {
    this.track(e);
    if (!this.down) return;
    this.down = false;
    this.onUp?.();
  };

  /** Nearest hit among the objects (recursive), or null. */
  pick(objects: THREE.Object3D[]): THREE.Intersection | null {
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.intersectObjects(objects, true)[0] ?? null;
  }

  /** Where the pointer ray crosses the horizontal plane y = `y`. */
  planePoint(y: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    this.ray.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.ray.ray;
    if (Math.abs(direction.y) < 1e-4) return null;
    const t = (y - origin.y) / direction.y;
    if (t < 0) return null;
    return out.copy(origin).addScaledVector(direction, t);
  }

  /** Optional framing guarantee; set by a minigame, then call resize(). */
  fit?: { halfWidth: number; distance: number };

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 1.4 ? 55 * Math.min(1.6, 1.4 / this.camera.aspect) : 55;
    if (this.fit) {
      // widen the vertical fov so a horizontal half-extent of `halfWidth` at `distance` always fits
      const need = 2 * Math.atan(Math.tan(Math.atan(this.fit.halfWidth / this.fit.distance)) / this.camera.aspect);
      this.camera.fov = Math.max(this.camera.fov, THREE.MathUtils.radToDeg(need));
    }
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pd);
    this.canvas.removeEventListener("pointermove", this.pm);
    this.canvas.removeEventListener("pointerup", this.pu);
    this.canvas.removeEventListener("pointercancel", this.pu);
    disposeObject(this.scene);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
