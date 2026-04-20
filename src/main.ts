import { SceneManager } from "@/SceneManager";
import { buildHyperlaneAdjacency, buildHyperlanePairs, GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import type { StarData } from "@/data/StarMap";
import { GALAXY_MAP } from "@/data/GalaxyMap";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudVisualToggles } from "@/ui/HudOverlay";

async function boot() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let activeSystemScene: SystemScene | null = null;
  let cachedGalaxyStars: StarData[] | null = null;
  let cachedGalaxyViewState: GalaxyViewState | null = null;
  let cachedHyperlaneAdjacency: number[][] = [];
  let currentSystemStar: StarData | null = null;

  const visualToggles: HudVisualToggles = {
    hyperlanes: true,
    bloom: true,
    centerCloud: true,
    stars: true,
    ownership: true,
  };

  const resolveRoutingStars = (): StarData[] => {
    if (cachedGalaxyStars && cachedGalaxyStars.length > 0) return cachedGalaxyStars;
    if (activeGalaxyScene) return activeGalaxyScene.getStars();
    return [];
  };

  const rebuildHyperlaneAdjacency = (stars: StarData[]): void => {
    if (stars.length === 0) {
      cachedHyperlaneAdjacency = [];
      return;
    }
    const pairs = buildHyperlanePairs(
      stars,
      GALAXY_MAP.width,
      GALAXY_MAP.height,
      GALAXY_MAP.shape,
      GALAXY_MAP.seed,
    );
    cachedHyperlaneAdjacency = buildHyperlaneAdjacency(pairs, stars.length);
  };

  const getConnectedSystems = (sourceStarId: number): HudConnectedSystem[] => {
    const stars = resolveRoutingStars();
    if (stars.length === 0) return [];

    const sourceIndex = stars.findIndex((s) => s.id === sourceStarId);
    if (sourceIndex < 0 || sourceIndex >= cachedHyperlaneAdjacency.length) return [];

    const targets: HudConnectedSystem[] = [];
    const neighborIndices = cachedHyperlaneAdjacency[sourceIndex] ?? [];
    for (const neighborIndex of neighborIndices) {
      const targetStar = stars[neighborIndex];
      if (!targetStar) continue;
      targets.push({ id: targetStar.id, name: targetStar.name });
    }
    return targets;
  };

  const applyVisualToggles = (): void => {
    if (activeGalaxyScene) {
      activeGalaxyScene.setHyperlanesVisible(visualToggles.hyperlanes);
      activeGalaxyScene.setBloomEnabled(visualToggles.bloom);
      activeGalaxyScene.setCenterCloudVisible(visualToggles.centerCloud);
      activeGalaxyScene.setStarsVisible(visualToggles.stars);
      activeGalaxyScene.setOwnershipVisible(visualToggles.ownership);
    }

    if (activeSystemScene) {
      activeSystemScene.setBloomEnabled(visualToggles.bloom);
      activeSystemScene.setStarsVisible(visualToggles.stars);
    }
  };

  let hud: HudOverlay;

  function updateHud(): void {
    const connectedSystems = currentSystemStar
      ? getConnectedSystems(currentSystemStar.id)
      : [];

    hud.update({
      title: currentSystemStar ? `${currentSystemStar.name} System` : "Galaxy Map",
      canExitSystem: currentSystemStar !== null,
      connectedSystems,
      toggles: visualToggles,
    });
  }

  async function switchScene(factory: () => IGameScene): Promise<void> {
    if (isSwitching) return;
    isSwitching = true;
    try {
      await mgr.startScene(factory());
    } finally {
      isSwitching = false;
    }
  }

  async function openGalaxyView(): Promise<void> {
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
      activeSystemScene = null;
      currentSystemStar = null;
      return galaxy;
    });

    if (activeGalaxyScene) {
      cachedGalaxyStars = activeGalaxyScene.getStars();
      rebuildHyperlaneAdjacency(cachedGalaxyStars);
    }

    applyVisualToggles();
    updateHud();
  }

  async function openSystemView(star: StarData): Promise<void> {
    if (activeGalaxyScene) {
      cachedGalaxyStars = activeGalaxyScene.getStars();
      cachedGalaxyViewState = activeGalaxyScene.captureViewState();
      activeGalaxyScene = null;
    }

    if (cachedGalaxyStars && cachedHyperlaneAdjacency.length !== cachedGalaxyStars.length) {
      rebuildHyperlaneAdjacency(cachedGalaxyStars);
    }

    await switchScene(() => {
      const system = new SystemScene(engine, star, () => openGalaxyView());
      activeSystemScene = system;
      currentSystemStar = star;
      return system;
    });

    applyVisualToggles();
    updateHud();
  }

  hud = new HudOverlay({
    onExitSystem: () => {
      if (!currentSystemStar) return;
      void openGalaxyView();
    },
    onNavigateConnectedSystem: (targetId) => {
      if (!currentSystemStar) return;
      const stars = resolveRoutingStars();
      const target = stars.find((s) => s.id === targetId);
      if (!target) return;
      void openSystemView(target);
    },
    onToggleVisual: (key, enabled) => {
      visualToggles[key] = enabled;
      applyVisualToggles();
      updateHud();
    },
  });

  await openGalaxyView();

  console.log("Space Strategy prototype running");
}

boot().catch(console.error);
