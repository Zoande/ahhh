import { SceneManager } from "@/SceneManager";
import { GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import type { StarData } from "@/data/StarMap";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";

async function boot() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let cachedGalaxyStars: StarData[] | null = null;
  let cachedGalaxyViewState: GalaxyViewState | null = null;

  const switchScene = async (factory: () => IGameScene): Promise<void> => {
    if (isSwitching) return;
    isSwitching = true;
    try {
      await mgr.startScene(factory());
    } finally {
      isSwitching = false;
    }
  };

  const openGalaxyView = async (): Promise<void> => {
    const options: GalaxySceneOptions = {};
    if (cachedGalaxyStars && cachedGalaxyStars.length > 0) {
      options.stars = cachedGalaxyStars;
    }
    if (cachedGalaxyViewState) {
      options.initialViewState = cachedGalaxyViewState;
    }

    await switchScene(() => {
      const galaxy = new GalaxyScene(engine, (star) => openSystemView(star), options);
      activeGalaxyScene = galaxy;
      return galaxy;
    });
  };

  const openSystemView = async (star: StarData): Promise<void> => {
    if (activeGalaxyScene) {
      cachedGalaxyStars = activeGalaxyScene.getStars();
      cachedGalaxyViewState = activeGalaxyScene.captureViewState();
      activeGalaxyScene = null;
    }

    await switchScene(() => new SystemScene(engine, star, () => openGalaxyView()));
  };

  await openGalaxyView();

  console.log("Space Strategy prototype running");
}

boot().catch(console.error);
