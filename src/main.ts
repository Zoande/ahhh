import { SceneManager } from "./SceneManager";
import { GalaxyScene } from "./scenes/GalaxyScene";

async function boot() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);

  const galaxy = new GalaxyScene(engine);
  await mgr.startScene(galaxy);

  console.log("Space Strategy prototype running");
}

boot().catch(console.error);
