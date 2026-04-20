import { Engine, WebGPUEngine } from "@babylonjs/core";
import type { AbstractEngine } from "@babylonjs/core";

export interface IGameScene {
  scene: import("@babylonjs/core").Scene;
  setup(): Promise<void>;
  onBeforeRender(): void;
  dispose(): void;
}

export class SceneManager {
  private engine!: AbstractEngine;
  private activeScene: IGameScene | null = null;
  private isRenderLoopRunning = false;
  private resizeHandler: (() => void) | null = null;

  async initEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
    let engine: AbstractEngine;
    try {
      const webgpu = new WebGPUEngine(canvas, { antialias: true });
      await webgpu.initAsync();
      engine = webgpu;
      console.log("✓ WebGPU engine");
    } catch {
      engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
      console.log("✓ WebGL2 engine (fallback)");
    }
    this.engine = engine;

    this.resizeHandler = () => engine.resize();
    window.addEventListener("resize", this.resizeHandler);
    return engine;
  }

  getEngine(): AbstractEngine {
    return this.engine;
  }

  /** Set and start the one-and-only scene */
  async startScene(gs: IGameScene): Promise<void> {
    if (this.activeScene) {
      this.activeScene.dispose();
    }
    this.activeScene = gs;
    await gs.setup();

    if (!this.isRenderLoopRunning) {
      this.engine.runRenderLoop(() => {
        const active = this.activeScene;
        if (!active) return;
        active.onBeforeRender();
        active.scene.render();
      });
      this.isRenderLoopRunning = true;
    }
  }

  dispose(): void {
    this.activeScene?.dispose();
    this.activeScene = null;
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}
