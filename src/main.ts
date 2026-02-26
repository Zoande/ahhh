import { SceneManager } from "./SceneManager";
import { GalaxyScene } from "./scenes/GalaxyScene";
import { TransitionController } from "./systems/TransitionController";

async function boot() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);

  const galaxy = new GalaxyScene(engine);
  await mgr.startScene(galaxy);

  // Quick fade-in to reveal the galaxy
  const transition = new TransitionController();
  transition.fadeIn(1.2);

  console.log("🚀 Space Strategy prototype running");
}

boot().catch(console.error);
