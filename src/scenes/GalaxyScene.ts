import {
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Texture,
  GlowLayer,
  PointLight,
  HemisphericLight,
  TransformNode,
} from "@babylonjs/core";
import type { AbstractEngine, Mesh } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { CameraController } from "../systems/CameraController";
import { OrbitSystem } from "../systems/OrbitSystem";

/* ─────────────────────── Star / System data ─────────────────────── */

interface SystemConfig {
  starDiameter: number;
  rocky:  { diameter: number; orbitRadius: number; orbitSpeed: number };
  gas:    { diameter: number; orbitRadius: number; orbitSpeed: number };
  ice:    { diameter: number; orbitRadius: number; orbitSpeed: number };
}

interface StarDef {
  id: number;
  name: string;
  position: Vector3;      // galaxy-plane position
  glowSize: number;       // diameter of the glow sphere seen from afar
  color: Color3;
  system: SystemConfig;
}

/** 5 stars, spread hundreds of units apart */
const STARS: StarDef[] = [
  {
    id: 0, name: "Sol",
    position: new Vector3(0, 0, 0),
    glowSize: 6, color: new Color3(1, 0.92, 0.7),
    system: {
      starDiameter: 5,
      rocky: { diameter: 1.5, orbitRadius: 8, orbitSpeed: 0.50 },
      gas:   { diameter: 3.0, orbitRadius: 18, orbitSpeed: 0.20 },
      ice:   { diameter: 1.2, orbitRadius: 13, orbitSpeed: 0.70 },
    },
  },
  {
    id: 1, name: "Vega",
    position: new Vector3(250, 0, -180),
    glowSize: 7, color: new Color3(0.75, 0.85, 1),
    system: {
      starDiameter: 5.5,
      rocky: { diameter: 1.2, orbitRadius: 9, orbitSpeed: 0.45 },
      gas:   { diameter: 3.8, orbitRadius: 20, orbitSpeed: 0.18 },
      ice:   { diameter: 1.0, orbitRadius: 14, orbitSpeed: 0.65 },
    },
  },
  {
    id: 2, name: "Antares",
    position: new Vector3(-300, 0, 150),
    glowSize: 9, color: new Color3(1, 0.55, 0.3),
    system: {
      starDiameter: 6.5,
      rocky: { diameter: 1.8, orbitRadius: 10, orbitSpeed: 0.40 },
      gas:   { diameter: 4.2, orbitRadius: 22, orbitSpeed: 0.15 },
      ice:   { diameter: 1.4, orbitRadius: 15, orbitSpeed: 0.55 },
    },
  },
  {
    id: 3, name: "Rigel",
    position: new Vector3(180, 0, 260),
    glowSize: 7.5, color: new Color3(0.7, 0.8, 1),
    system: {
      starDiameter: 5.8,
      rocky: { diameter: 1.0, orbitRadius: 7, orbitSpeed: 0.55 },
      gas:   { diameter: 2.6, orbitRadius: 16, orbitSpeed: 0.22 },
      ice:   { diameter: 1.6, orbitRadius: 12, orbitSpeed: 0.75 },
    },
  },
  {
    id: 4, name: "Betelgeuse",
    position: new Vector3(-200, 0, -280),
    glowSize: 10, color: new Color3(1, 0.6, 0.35),
    system: {
      starDiameter: 7.0,
      rocky: { diameter: 2.0, orbitRadius: 11, orbitSpeed: 0.35 },
      gas:   { diameter: 3.4, orbitRadius: 24, orbitSpeed: 0.12 },
      ice:   { diameter: 1.1, orbitRadius: 16, orbitSpeed: 0.60 },
    },
  },
];

/* ─────────────── Transition thresholds ─────────────── */

/** Distance from camera target to a star to consider it "focused" */
const FOCUS_DIST = 60;
/** Camera radius at which the glow starts fading out and system fades in */
const TRANSITION_START = 55;
/** Camera radius at which the system is fully visible and glow gone */
const TRANSITION_END = 18;

/* ─────────────── Per-star runtime data ─────────────── */

interface StarRuntime {
  def: StarDef;
  glowMesh: Mesh;
  systemRoot: TransformNode;
  starMesh: Mesh;
  planetMeshes: Mesh[];
  light: PointLight;
  orbitSystem: OrbitSystem;
  systemVisible: boolean;
}

/* ═══════════════════════════════════════════════════════════════════ */

export class GalaxyScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private cam!: CameraController;
  private starRuntimes: StarRuntime[] = [];
  private glowLayer!: GlowLayer;

  constructor(engine: AbstractEngine) {
    this.engine = engine;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
  }

  async setup(): Promise<void> {
    const canvas = this.engine.getRenderingCanvas()!;

    // ── Camera: 2.5D isometric-ish, big zoom range ──
    this.cam = new CameraController(this.scene, canvas, {
      alpha: -Math.PI / 2,
      beta: Math.PI / 4,
      radius: 120,
      target: Vector3.Zero(),
      lowerRadiusLimit: 5,
      upperRadiusLimit: 300,
      lowerBetaLimit: 0.25,
      upperBetaLimit: Math.PI / 3,
      wheelPrecision: 5,
      inertia: 0.88,
    });

    // ── Background skybox ──
    const bgSphere = MeshBuilder.CreateSphere("bg", { diameter: 2000, segments: 24 }, this.scene);
    const bgMat = new StandardMaterial("bgMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.png", this.scene);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgSphere.material = bgMat;
    bgSphere.isPickable = false;
    bgSphere.infiniteDistance = true;

    // ── Glow layer ──
    this.glowLayer = new GlowLayer("glow", this.scene, {
      mainTextureFixedSize: 1024,
      blurKernelSize: 64,
    });
    this.glowLayer.intensity = 1.4;

    // ── Subtle ambient for planets when they appear ──
    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.08;
    ambient.diffuse = new Color3(0.3, 0.35, 0.5);
    ambient.specular = new Color3(0, 0, 0);

    // ── Shared textures ──
    const glowTex     = new Texture("/textures/star.glow.png", this.scene);
    const surfaceTex  = new Texture("/textures/star_surface.png", this.scene);
    const rockyTex    = new Texture("/textures/rocky_planet.png", this.scene);
    const gasTex      = new Texture("/textures/gas_giant.png", this.scene);
    const iceTex      = new Texture("/textures/ice_planet.png", this.scene);

    // ── Build each star ──
    for (const def of STARS) {
      const rt = this.buildStar(def, glowTex, surfaceTex, rockyTex, gasTex, iceTex);
      this.starRuntimes.push(rt);
    }

    await this.scene.whenReadyAsync();
  }

  /* ─────────── Build one star with glow + system ─────────── */

  private buildStar(
    def: StarDef,
    glowTex: Texture,
    surfaceTex: Texture,
    rockyTex: Texture,
    gasTex: Texture,
    iceTex: Texture,
  ): StarRuntime {
    const cfg = def.system;

    // ── Glow sphere (visible from galaxy distance) ──
    const glowMesh = MeshBuilder.CreateSphere(
      `glow_${def.id}`, { diameter: def.glowSize, segments: 16 }, this.scene
    );
    const glowMat = new StandardMaterial(`glowMat_${def.id}`, this.scene);
    glowMat.emissiveTexture = glowTex;
    glowMat.emissiveColor = def.color;
    glowMat.diffuseColor = Color3.Black();
    glowMat.specularColor = Color3.Black();
    glowMat.disableLighting = true;
    glowMat.alpha = 1;
    glowMesh.material = glowMat;
    glowMesh.position = def.position.clone();
    glowMesh.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(glowMesh);

    // ── System root (parent transform for star surface + planets) ──
    const systemRoot = new TransformNode(`sysRoot_${def.id}`, this.scene);
    systemRoot.position = def.position.clone();

    // Star surface
    const starMesh = MeshBuilder.CreateSphere(
      `star_${def.id}`, { diameter: cfg.starDiameter, segments: 32 }, this.scene
    );
    const starMat = new StandardMaterial(`starSurfMat_${def.id}`, this.scene);
    starMat.emissiveTexture = surfaceTex;
    starMat.emissiveColor = def.color.scale(0.9);
    starMat.diffuseColor = Color3.Black();
    starMat.specularColor = Color3.Black();
    starMat.disableLighting = true;
    starMesh.material = starMat;
    starMesh.parent = systemRoot;
    starMesh.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(starMesh);

    // Point light at star center
    const light = new PointLight(`light_${def.id}`, Vector3.Zero(), this.scene);
    light.parent = systemRoot;
    light.intensity = 0; // starts invisible
    light.diffuse = new Color3(1, 0.95, 0.85);
    light.specular = new Color3(1, 0.95, 0.85);
    light.range = 50;

    // ── Planets ──
    const orbitSystem = new OrbitSystem();
    const planetMeshes: Mesh[] = [];

    // Rocky
    const rocky = MeshBuilder.CreateSphere(`rocky_${def.id}`, { diameter: cfg.rocky.diameter, segments: 20 }, this.scene);
    const rockyMat = new StandardMaterial(`rockyMat_${def.id}`, this.scene);
    rockyMat.diffuseTexture = rockyTex;
    rockyMat.specularColor = new Color3(0.1, 0.1, 0.1);
    rocky.material = rockyMat;
    rocky.parent = systemRoot;
    planetMeshes.push(rocky);
    orbitSystem.addBody({
      mesh: rocky,
      orbitRadius: cfg.rocky.orbitRadius,
      orbitSpeed: cfg.rocky.orbitSpeed,
      currentAngle: Math.random() * Math.PI * 2,
      axialRotationSpeed: 0.3,
    });

    // Gas giant
    const gas = MeshBuilder.CreateSphere(`gas_${def.id}`, { diameter: cfg.gas.diameter, segments: 20 }, this.scene);
    const gasMat = new StandardMaterial(`gasMat_${def.id}`, this.scene);
    gasMat.diffuseTexture = gasTex;
    gasMat.specularColor = new Color3(0.05, 0.05, 0.05);
    gas.material = gasMat;
    gas.parent = systemRoot;
    planetMeshes.push(gas);
    orbitSystem.addBody({
      mesh: gas,
      orbitRadius: cfg.gas.orbitRadius,
      orbitSpeed: cfg.gas.orbitSpeed,
      currentAngle: Math.random() * Math.PI * 2,
      axialRotationSpeed: 0.15,
    });

    // Ice
    const ice = MeshBuilder.CreateSphere(`ice_${def.id}`, { diameter: cfg.ice.diameter, segments: 20 }, this.scene);
    const iceMat = new StandardMaterial(`iceMat_${def.id}`, this.scene);
    iceMat.diffuseTexture = iceTex;
    iceMat.specularColor = new Color3(0.3, 0.3, 0.4);
    ice.material = iceMat;
    ice.parent = systemRoot;
    planetMeshes.push(ice);
    orbitSystem.addBody({
      mesh: ice,
      orbitRadius: cfg.ice.orbitRadius,
      orbitSpeed: cfg.ice.orbitSpeed,
      currentAngle: Math.random() * Math.PI * 2,
      axialRotationSpeed: 0.4,
    });

    // Start system hidden
    starMesh.visibility = 0;
    for (const p of planetMeshes) p.visibility = 0;

    return {
      def,
      glowMesh,
      systemRoot,
      starMesh,
      planetMeshes,
      light,
      orbitSystem,
      systemVisible: false,
    };
  }

  /* ─────────── Per-frame update ─────────── */

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    const camTarget = this.cam.target;
    const camRadius = this.cam.radius;

    // WASD / edge panning
    this.cam.updatePanning(dt);

    for (const rt of this.starRuntimes) {
      // Distance from camera focus point to this star (XZ plane)
      const dist = Vector3.Distance(
        new Vector3(camTarget.x, 0, camTarget.z),
        new Vector3(rt.def.position.x, 0, rt.def.position.z)
      );

      const isFocused = dist < FOCUS_DIST;

      // ── Compute blend factor: 0 = galaxy view, 1 = fully in system ──
      let blend = 0;
      if (isFocused) {
        if (camRadius <= TRANSITION_END) {
          blend = 1;
        } else if (camRadius >= TRANSITION_START) {
          blend = 0;
        } else {
          blend = 1 - (camRadius - TRANSITION_END) / (TRANSITION_START - TRANSITION_END);
        }
      }

      // Smooth the blend with a cubic curve for nicer feel
      blend = blend * blend * (3 - 2 * blend);

      // ── Apply blend ──

      // Glow: visible when blend=0, invisible when blend=1
      const glowAlpha = 1 - blend;
      (rt.glowMesh.material as StandardMaterial).alpha = glowAlpha;
      rt.glowMesh.visibility = glowAlpha > 0.01 ? 1 : 0;
      // Scale glow down as we zoom in for a shrinking-glow effect
      const glowScale = 1 - blend * 0.5;
      rt.glowMesh.scaling.setAll(glowScale);

      // System: visible when blend > 0
      rt.starMesh.visibility = blend;
      for (const p of rt.planetMeshes) {
        p.visibility = blend;
      }
      rt.light.intensity = blend * 2.5;

      // Only run orbit sim for visible systems
      if (blend > 0.01) {
        rt.orbitSystem.update(dt);
        rt.starMesh.rotation.y += 0.05 * dt;
        rt.systemVisible = true;
      } else {
        rt.systemVisible = false;
      }

      // Slow-rotate the glow
      rt.glowMesh.rotation.y += 0.15 * dt;
    }
  }

  dispose(): void {
    for (const rt of this.starRuntimes) {
      rt.orbitSystem.dispose();
    }
    this.cam.dispose();
    this.scene.dispose();
  }
}
