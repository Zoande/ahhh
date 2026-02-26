import { ArcRotateCamera, Vector3, KeyboardEventTypes } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

export interface CameraConfig {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
  lowerRadiusLimit: number;
  upperRadiusLimit: number;
  lowerBetaLimit?: number;
  upperBetaLimit?: number;
  wheelPrecision: number;
  inertia: number;
}

/**
 * CameraController
 * ArcRotateCamera with WASD + mouse-edge panning on the XZ plane.
 * Scroll wheel zooms in/out. Right-click drag to orbit.
 */
export class CameraController {
  public camera: ArcRotateCamera;
  private scene: Scene;
  private canvas: HTMLCanvasElement;

  // WASD / edge pan state
  private keysDown = new Set<string>();
  private panSpeed = 40;        // units per second at max zoom-out
  private edgeThreshold = 40;   // pixels from screen edge
  private mouseX = 0;
  private mouseY = 0;

  // bound handlers for cleanup
  private _onMouseMove: (e: MouseEvent) => void;

  constructor(scene: Scene, canvas: HTMLCanvasElement, config: CameraConfig) {
    this.scene = scene;
    this.canvas = canvas;

    this.camera = new ArcRotateCamera(
      "camera",
      config.alpha,
      config.beta,
      config.radius,
      config.target.clone(),
      scene
    );

    this.camera.attachControl(canvas, true);

    // Zoom limits
    this.camera.lowerRadiusLimit = config.lowerRadiusLimit;
    this.camera.upperRadiusLimit = config.upperRadiusLimit;

    if (config.lowerBetaLimit !== undefined) {
      this.camera.lowerBetaLimit = config.lowerBetaLimit;
    }
    if (config.upperBetaLimit !== undefined) {
      this.camera.upperBetaLimit = config.upperBetaLimit;
    }

    this.camera.wheelPrecision = config.wheelPrecision;
    this.camera.inertia = config.inertia;

    // Disable panning via right-click drag — we handle our own panning
    this.camera.panningSensibility = 0;

    // Disable default camera keyboard controls
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];

    this.camera.useAutoRotationBehavior = false;
    this.camera.useBouncingBehavior = false;
    this.camera.useFramingBehavior = false;

    // ── Keyboard input ──
    scene.onKeyboardObservable.add((kbInfo) => {
      const key = kbInfo.event.key.toLowerCase();
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        this.keysDown.add(key);
      } else {
        this.keysDown.delete(key);
      }
    });

    // ── Mouse position for edge panning ──
    this._onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    canvas.addEventListener("mousemove", this._onMouseMove);
  }

  get radius(): number {
    return this.camera.radius;
  }

  get target(): Vector3 {
    return this.camera.target;
  }

  /**
   * Call each frame with dt in seconds.
   * Handles WASD + mouse-edge panning on the XZ plane.
   */
  updatePanning(dt: number): void {
    // Scale pan speed: faster when zoomed out, slower when zoomed in
    const radiusFactor = this.camera.radius / (this.camera.upperRadiusLimit ?? 300);
    const speed = this.panSpeed * radiusFactor;

    let dx = 0;
    let dz = 0;

    // WASD
    if (this.keysDown.has("w") || this.keysDown.has("arrowup")) dz -= 1;
    if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) dz += 1;
    if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) dx -= 1;
    if (this.keysDown.has("d") || this.keysDown.has("arrowright")) dx += 1;

    // Mouse edge panning
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const et = this.edgeThreshold;

    if (this.mouseX < et) dx -= 1;
    if (this.mouseX > w - et) dx += 1;
    if (this.mouseY < et) dz -= 1;
    if (this.mouseY > h - et) dz += 1;

    if (dx === 0 && dz === 0) return;

    // Normalize if diagonal
    const len = Math.sqrt(dx * dx + dz * dz);
    dx /= len;
    dz /= len;

    // Get camera forward direction projected onto XZ
    const forward = this.camera.getForwardRay().direction;
    const fwd = new Vector3(forward.x, 0, forward.z).normalize();
    const right = new Vector3(fwd.z, 0, -fwd.x); // perpendicular on XZ

    const move = fwd.scale(dz * speed * dt).add(right.scale(dx * speed * dt));
    // We move in camera-relative XZ, but the panning should feel like
    // "screen-space" directions, so we negate to make W = forward
    this.camera.target.addInPlace(move.scale(-1));
  }

  /**
   * Smoothly animate both target and radius simultaneously.
   */
  animateTargetAndRadius(targetPos: Vector3, targetRadius: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const startPos = this.camera.target.clone();
      const startRadius = this.camera.radius;
      const startTime = performance.now();
      const durationMs = duration * 1000;

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.camera.target = Vector3.Lerp(startPos, targetPos, eased);
        this.camera.radius = startRadius + (targetRadius - startRadius) * eased;

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          this.camera.target = targetPos.clone();
          this.camera.radius = targetRadius;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  dispose(): void {
    this.canvas.removeEventListener("mousemove", this._onMouseMove);
    this.camera.detachControl();
    this.camera.dispose();
  }
}
