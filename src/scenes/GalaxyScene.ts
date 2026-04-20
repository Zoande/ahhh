/**
 * GalaxyScene — Main scene orchestrator.
 *
 * Layers:
 *   1. Background skybox (galaxy_bg.png)
 *   2. Star field (sprite glows via StarFieldRenderer)
 *   3. Active system (star mesh + planets, built on demand when selected)
 *
 * Interaction flow:
 *  - Left click a star in galaxy view to enter its system immediately.
 *  - Right click while in system view to return to galaxy view.
 */

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
  PointerEventTypes,
} from "@babylonjs/core";
import type { AbstractEngine, Mesh, Observer, PointerInfo } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { GALAXY_MAP } from "../data/GalaxyMap";
import { generateStarMap, STAR_TYPES } from "../data/StarMap";
import type { StarData } from "../data/StarMap";
import { CameraController } from "../systems/CameraController";
import { StarFieldRenderer } from "../systems/StarFieldRenderer";
import { OrbitSystem } from "../systems/OrbitSystem";

/* ═══════════════════════ Active system runtime ═══════════════════════ */

interface ActiveSystem {
  starId: number;
  root: TransformNode;
  starMesh: Mesh;
  planetMeshes: Mesh[];
  light: PointLight;
  orbitSystem: OrbitSystem;
}

/* ═══════════════════════ GalaxyScene ═══════════════════════ */

export class GalaxyScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private canvas!: HTMLCanvasElement;
  private cam!: CameraController;
  private starField!: StarFieldRenderer;
  private stars: StarData[] = [];
  private glowLayer!: GlowLayer;
  private clickPlane!: Mesh;

  private pointerObserver: Observer<PointerInfo> | null = null;
  private starById = new Map<number, StarData>();

  private readonly onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  // Currently loaded star system (only one at a time)
  private activeSystem: ActiveSystem | null = null;
  private activeStarId: number | null = null;

  // Shared textures (preloaded once, reused for any system)
  private surfaceTex!: Texture;
  private rockyTex!: Texture;
  private gasTex!: Texture;
  private iceTex!: Texture;

  constructor(engine: AbstractEngine) {
    this.engine = engine;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
  }

  /* ─────────────────────── Setup ─────────────────────── */

  async setup(): Promise<void> {
    const canvas = this.engine.getRenderingCanvas()!;
    this.canvas = canvas;
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    const cfg = GALAXY_MAP;

    // ── Generate the star map ──
    this.stars = generateStarMap(
      cfg.width, cfg.height, cfg.starCount, cfg.seed, cfg.minStarSpacing, cfg.shape,
    );
    this.starById.clear();
    for (const star of this.stars) {
      this.starById.set(star.id, star);
    }
    console.log(`Generated ${this.stars.length} stars`);

    // ── Camera ──
    this.cam = new CameraController(this.scene, canvas, {
      alpha: cfg.camera.startAlpha,
      beta: cfg.camera.startBeta,
      radius: cfg.camera.startRadius,
      target: Vector3.Zero(),
      lowerRadiusLimit: cfg.camera.minRadius,
      upperRadiusLimit: cfg.camera.maxRadius,
      lowerBetaLimit: cfg.camera.minBeta,
      upperBetaLimit: cfg.camera.maxBeta,
      wheelDeltaPercentage: cfg.camera.wheelDeltaPercentage,
      inertia: cfg.camera.inertia,
    });

    // Clamp panning to the galaxy bounds
    this.cam.setBounds(
      -cfg.width / 2, cfg.width / 2,
      -cfg.height / 2, cfg.height / 2,
    );

    // Invisible pick surface for converting screen clicks to XZ coordinates.
    this.clickPlane = MeshBuilder.CreateGround(
      "galaxyClickPlane",
      { width: cfg.width * 1.5, height: cfg.height * 1.5 },
      this.scene,
    );
    this.clickPlane.isVisible = false;
    this.clickPlane.isPickable = true;

    // ── Background skybox ──
    const bgSphere = MeshBuilder.CreateSphere(
      "bg", { diameter: 5000, segments: 24 }, this.scene,
    );
    const bgMat = new StandardMaterial("bgMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.png", this.scene);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgSphere.material = bgMat;
    bgSphere.isPickable = false;
    bgSphere.infiniteDistance = true;

    // ── Glow layer (for system star + planets when zoomed in) ──
    this.glowLayer = new GlowLayer("glow", this.scene, {
      mainTextureFixedSize: 512,
      blurKernelSize: 32,
    });
    this.glowLayer.intensity = 1.2;

    // ── Subtle ambient light for planets ──
    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.08;
    ambient.diffuse = new Color3(0.3, 0.35, 0.5);
    ambient.specular = Color3.Black();

    // ── Star field (all 1000 stars as billboard sprites) ──
    this.starField = new StarFieldRenderer(this.scene, this.stars);

    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const ev = pointerInfo.event as PointerEvent;

      if (ev.button === 2) {
        if (this.activeStarId !== null) {
          this.exitSystemView();
        }
        return;
      }

      if (ev.button !== 0) return;
      if (this.activeStarId !== null) return;
      this.tryEnterSystemAtPointer();
    });

    // ── Preload shared textures for system view ──
    this.surfaceTex = new Texture("/textures/star_surface.png", this.scene);
    this.rockyTex = new Texture("/textures/rocky_planet.png", this.scene);
    this.gasTex = new Texture("/textures/gas_giant.png", this.scene);
    this.iceTex = new Texture("/textures/ice_planet.png", this.scene);

    await this.scene.whenReadyAsync();
  }

  /* ─────────────────────── Per-frame ─────────────────────── */

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    const trans = GALAXY_MAP.transition;
    const cam = this.cam.camera;
    const minRadius = cam.lowerRadiusLimit ?? GALAXY_MAP.camera.minRadius;
    const maxRadius = cam.upperRadiusLimit ?? GALAXY_MAP.camera.maxRadius;
    const zoomOutBlend =
      (this.cam.radius - minRadius) / Math.max(0.0001, maxRadius - minRadius);

    // Camera panning (WASD / edge / bounds enforcement)
    this.cam.updatePanning(dt);

    this.starField.resetOverrides();
    this.starField.setZoomOutBlend(zoomOutBlend);

    const activeStar =
      this.activeStarId !== null ? (this.starById.get(this.activeStarId) ?? null) : null;

    if (activeStar && this.activeSystem) {
      this.cam.setSystemFocus(
        new Vector3(activeStar.x, 0, activeStar.z),
        trans.systemBorderRadius,
        1,
      );

      this.starField.suppressNeighbors(
        activeStar.id,
        trans.suppressionRadius,
        1,
        trans.suppressionMinAlpha,
        trans.suppressionShrinkFactor,
      );
      this.starField.setStarAlpha(activeStar.id, 0);

      const sys = this.activeSystem;
      sys.root.scaling.setAll(1);
      sys.light.range = 50;
      sys.light.intensity = 2.5;
      sys.starMesh.visibility = 1;
      for (const p of sys.planetMeshes) {
        p.visibility = 1;
      }

      sys.orbitSystem.update(dt);
      sys.starMesh.rotation.y += 0.05 * dt;
    } else {
      this.cam.clearSystemFocus();
    }

    this.starField.applyVisuals();
  }

  private tryEnterSystemAtPointer(): void {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.clickPlane,
      false,
      this.cam.camera,
    );

    if (!pick?.hit || !pick.pickedPoint) return;

    const clickX = pick.pickedPoint.x;
    const clickZ = pick.pickedPoint.z;
    const pickRadius = Math.max(12, this.cam.radius * 0.025);
    const pickRadiusSq = pickRadius * pickRadius;

    let nearestStar: StarData | null = null;
    let nearestDistSq = Infinity;

    for (const star of this.stars) {
      const dx = clickX - star.x;
      const dz = clickZ - star.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestStar = star;
      }
    }

    if (!nearestStar || nearestDistSq > pickRadiusSq) return;
    this.enterSystemView(nearestStar);
  }

  private enterSystemView(star: StarData): void {
    this.disposeActiveSystem();
    this.buildSystem(star);
    this.activeStarId = star.id;

    this.cam.target.set(star.x, 0, star.z);

    const lower = this.cam.camera.lowerRadiusLimit ?? 0;
    const upper = this.cam.camera.upperRadiusLimit ?? Number.POSITIVE_INFINITY;
    const entryRadius = Math.min(upper, Math.max(lower, 22));
    this.cam.camera.radius = entryRadius;
  }

  private exitSystemView(): void {
    if (this.activeStarId === null) return;

    this.disposeActiveSystem();
    this.activeStarId = null;
    this.cam.clearSystemFocus();

    const lower = this.cam.camera.lowerRadiusLimit ?? 0;
    const upper = this.cam.camera.upperRadiusLimit ?? Number.POSITIVE_INFINITY;
    const galaxyRadius = Math.min(upper, Math.max(lower, GALAXY_MAP.camera.startRadius));
    this.cam.camera.radius = galaxyRadius;
  }

  /* ─────────────────── System building ─────────────────── */

  private buildSystem(star: StarData): void {
    const typeCfg = STAR_TYPES[star.type];

    // Root transform at star's galaxy position
    const root = new TransformNode(`sysRoot_${star.id}`, this.scene);
    root.position.set(star.x, 0, star.z);

    // ── Star surface mesh ──
    const starMesh = MeshBuilder.CreateSphere(
      `star_${star.id}`,
      { diameter: typeCfg.systemDiameter, segments: 32 },
      this.scene,
    );
    const starMat = new StandardMaterial(`starMat_${star.id}`, this.scene);
    starMat.emissiveTexture = this.surfaceTex;
    starMat.emissiveColor = new Color3(star.color[0], star.color[1], star.color[2]).scale(0.9);
    starMat.diffuseColor = Color3.Black();
    starMat.specularColor = Color3.Black();
    starMat.disableLighting = true;
    starMesh.material = starMat;
    starMesh.parent = root;
    starMesh.isPickable = false;
    starMesh.visibility = 1;
    this.glowLayer.addIncludedOnlyMesh(starMesh);

    // ── Point light at star center ──
    const light = new PointLight(`light_${star.id}`, Vector3.Zero(), this.scene);
    light.parent = root;
    light.intensity = 2.5;
    light.diffuse = new Color3(star.color[0], star.color[1], star.color[2]);
    light.specular = new Color3(0.8, 0.8, 0.8);
    light.range = 50;

    // ── Planets ──
    const orbitSystem = new OrbitSystem();
    const planetMeshes: Mesh[] = [];
    const texMap: Record<string, Texture> = {
      rocky: this.rockyTex,
      gas: this.gasTex,
      ice: this.iceTex,
    };

    for (let i = 0; i < star.system.planets.length; i++) {
      const planet = star.system.planets[i];
      const mesh = MeshBuilder.CreateSphere(
        `planet_${star.id}_${i}`,
        { diameter: planet.diameter, segments: 20 },
        this.scene,
      );
      const mat = new StandardMaterial(`pMat_${star.id}_${i}`, this.scene);
      mat.diffuseTexture = texMap[planet.type] ?? this.rockyTex;
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mesh.material = mat;
      mesh.parent = root;
      mesh.visibility = 1;
      planetMeshes.push(mesh);

      orbitSystem.addBody({
        mesh,
        orbitRadius: planet.orbitRadius,
        orbitSpeed: planet.orbitSpeed,
        currentAngle: Math.random() * Math.PI * 2,
        axialRotationSpeed: 0.2 + Math.random() * 0.3,
      });
    }

    this.activeSystem = {
      starId: star.id,
      root,
      starMesh,
      planetMeshes,
      light,
      orbitSystem,
    };
  }

  private disposeActiveSystem(): void {
    if (!this.activeSystem) return;
    const sys = this.activeSystem;
    sys.orbitSystem.dispose();
    sys.light.dispose();
    for (const p of sys.planetMeshes) {
      p.material?.dispose();
      p.dispose();
    }
    sys.starMesh.material?.dispose();
    sys.starMesh.dispose();
    sys.root.dispose();
    this.activeSystem = null;
  }

  /* ─────────────────── Disposal ─────────────────── */

  dispose(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.canvas?.removeEventListener("contextmenu", this.onContextMenu);
    this.clickPlane?.dispose();
    this.disposeActiveSystem();
    this.starField.dispose();
    this.cam.dispose();
    this.scene.dispose();
  }
}
