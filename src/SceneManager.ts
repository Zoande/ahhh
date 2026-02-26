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

    window.addEventListener("resize", () => engine.resize());
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

    gs.scene.registerBeforeRender(() => gs.onBeforeRender());

    this.engine.runRenderLoop(() => {
      gs.scene.render();
    });
  }

  dispose(): void {
    this.activeScene?.dispose();
    this.engine.dispose();
  }
}
