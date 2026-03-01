/**
 * GalaxyScene — Main scene orchestrator.
 *
 * Layers:
 *   1. Background skybox (galaxy_bg.png)
 *   2. Star field (1000 sprite glows via StarFieldRenderer)
 *   3. Active system (star mesh + planets, built on demand when zoomed in)
 *
 * Seamless zoom transition with:
 *  - Target locking (prevents switching stars mid-transition)
 *  - Neighbor suppression (fade + shrink nearby stars)
 *  - Camera magnetization (gradual centering on focused star)
 *  - Non-linear system scaling (spatial decoupling trick)
 *  - Smooth reverse transition on zoom-out
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
} from "@babylonjs/core";
import type { AbstractEngine, Mesh } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { GALAXY_MAP } from "../data/GalaxyMap";
import { generateStarMap, STAR_TYPES } from "../data/StarMap";
import type { StarData } from "../data/StarMap";
import { CameraController } from "../systems/CameraController";
import { StarFieldRenderer } from "../systems/StarFieldRenderer";
import { OrbitSystem } from "../systems/OrbitSystem";

/* ═══════════════════════ Transition state ═══════════════════════ */

const enum TransitionPhase {
  /** Full galaxy view — no system active */
  GALAXY = 0,
  /** Zooming in — blend increasing from 0→1 */
  ZOOMING_IN = 1,
  /** Fully inside a system */
  IN_SYSTEM = 2,
  /** Zooming back out — blend decreasing from 1→0 */
  ZOOMING_OUT = 3,
}

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
  private cam!: CameraController;
  private starField!: StarFieldRenderer;
  private stars: StarData[] = [];
  private glowLayer!: GlowLayer;

  // Currently loaded star system (only one at a time)
  private activeSystem: ActiveSystem | null = null;

  // Transition state
  private phase: TransitionPhase = TransitionPhase.GALAXY;
  private lockedStarId = -1;         // Target-locked star during transition
  private blend = 0;                 // 0 = galaxy, 1 = fully in system
  private suppressionBlend = 0;      // Smoothed suppression strength

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
    const cfg = GALAXY_MAP;

    // ── Generate the star map ──
    this.stars = generateStarMap(
      cfg.width, cfg.height, cfg.starCount, cfg.seed, cfg.minStarSpacing, cfg.shape,
    );
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
    const camTarget = this.cam.target;
    const camRadius = this.cam.radius;
    const trans = GALAXY_MAP.transition;

    // Camera panning (WASD / edge / bounds enforcement)
    this.cam.updatePanning(dt);

    // ── Find nearest star to camera target ──
    let nearestStar: StarData | null = null;
    let nearestDistSq = Infinity;
    for (const star of this.stars) {
      const dx = camTarget.x - star.x;
      const dz = camTarget.z - star.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestStar = star;
      }
    }
    const nearestDist = Math.sqrt(nearestDistSq);

    // ── Determine if we're exiting (use wider thresholds) ──
    // Once inside a system, use the more lenient "out" thresholds so
    // the player has to zoom out 2-3x further to leave.
    const isInSystem = this.lockedStarId >= 0 && this.blend > 0.01;
    const activeFadeStart = isInSystem ? trans.systemFadeStartOut : trans.systemFadeStart;
    const activeFadeEnd   = isInSystem ? trans.systemFadeEndOut   : trans.systemFadeEnd;
    const activeFocusDist = isInSystem ? trans.focusDistanceOut   : trans.focusDistance;

    // ── Can we focus on the nearest star? ──
    const canFocusNearest =
      nearestStar !== null &&
      nearestDist < activeFocusDist &&
      camRadius < activeFadeStart;

    // ── Target lock logic ──
    // Once blend exceeds the lock threshold, the focused star is locked
    // and won't change until the transition fully reverses (blend ≈ 0).
    const isLocked = this.lockedStarId >= 0 && this.blend > trans.lockBlendThreshold;

    let focusStar: StarData | null = null;
    if (isLocked) {
      // Stay locked on current star regardless of nearest
      focusStar = this.stars[this.lockedStarId];
    } else if (canFocusNearest && nearestStar) {
      focusStar = nearestStar;
    }

    // ── Compute target blend (0 = galaxy view, 1 = fully in system) ──
    let targetBlend = 0;
    if (focusStar) {
      // Distance from camera target to the focus star (for locked stars,
      // this may differ from nearestDist)
      const fdx = camTarget.x - focusStar.x;
      const fdz = camTarget.z - focusStar.z;
      const focusDist = Math.sqrt(fdx * fdx + fdz * fdz);

      // Only blend in if camera is close enough to the focus star AND zoomed in
      if (focusDist < activeFocusDist && camRadius < activeFadeStart) {
        if (camRadius <= activeFadeEnd) {
          targetBlend = 1;
        } else {
          targetBlend =
            1 - (camRadius - activeFadeEnd) / (activeFadeStart - activeFadeEnd);
        }
      }
    }

    // Smoothstep for nicer feel
    targetBlend = targetBlend * targetBlend * (3 - 2 * targetBlend);

    // Smooth blend changes over time to prevent jarring transitions
    const blendSpeed = 4.0; // how fast blend catches up
    this.blend += (targetBlend - this.blend) * Math.min(1, blendSpeed * dt);
    // Snap to exact values at extremes
    if (this.blend < 0.005) this.blend = 0;
    if (this.blend > 0.995) this.blend = 1;

    // ── Update transition phase ──
    this.updatePhase(focusStar);

    // ── Camera magnetization: gradually center on focused star ──
    if (focusStar && this.blend > trans.magnetStartBlend) {
      const magnetT = Math.min(1, trans.magnetStrength * dt);
      // Strength ramps up with blend so it's subtle at start, strong when close
      const strength = magnetT * this.blend;
      const starPos = new Vector3(focusStar.x, 0, focusStar.z);
      const current = this.cam.target;
      current.x += (starPos.x - current.x) * strength;
      current.z += (starPos.z - current.z) * strength;
    }

    // ── Reset star field overrides for this frame ──
    this.starField.resetOverrides();

    // ── Neighbor suppression ──
    if (focusStar && this.blend > trans.suppressionStartBlend) {
      // Smoothly ramp suppression from 0→1 based on blend
      const suppRaw = (this.blend - trans.suppressionStartBlend)
        / (1 - trans.suppressionStartBlend);
      const suppTarget = Math.min(1, suppRaw);
      // Smooth it to avoid flickering
      this.suppressionBlend += (suppTarget - this.suppressionBlend) * Math.min(1, 5 * dt);

      this.starField.suppressNeighbors(
        focusStar.id,
        trans.suppressionRadius,
        this.suppressionBlend,
        trans.suppressionMinAlpha,
        trans.suppressionShrinkFactor,
      );
    } else {
      this.suppressionBlend = 0;
    }

    // ── Focused star sprite: enlarge slightly then fade ──
    if (focusStar) {
      // Before system is visible, slightly enlarge the focus star glow
      // to create a "pulling in" effect. Then fade as system appears.
      const highlightScale = 1 + 0.3 * this.blend * (1 - this.blend) * 4; // peaks at blend=0.5
      this.starField.setStarScale(focusStar.id, highlightScale);
      // Fade the star sprite as system fades in
      this.starField.setStarAlpha(focusStar.id, 1 - this.blend);
    }

    // Apply all visual overrides to star sprites
    this.starField.applyVisuals();

    // ── Build / swap / dispose active system ──
    const wantedSystemId = focusStar && this.blend > 0 ? focusStar.id : -1;

    if (wantedSystemId !== (this.activeSystem?.starId ?? -1)) {
      // Need to build or swap system
      if (wantedSystemId >= 0 && focusStar) {
        // Dispose old system first
        this.disposeActiveSystem();
        this.buildSystem(focusStar);
      } else if (wantedSystemId < 0) {
        // Dispose system (zoomed out)
        this.disposeActiveSystem();
      }
    }

    // ── Update active system visibility + dynamic scale ──
    if (this.activeSystem && focusStar) {
      const sys = this.activeSystem;

      // Fade system meshes in/out
      sys.starMesh.visibility = this.blend;
      for (const p of sys.planetMeshes) {
        p.visibility = this.blend;
      }
      sys.light.intensity = this.blend * 2.5;

      // ── Dynamic scale trick (spatial decoupling) ──
      // System starts tiny (fitting inside the glow sprite) and smoothly
      // expands to full scale as you zoom closer. This creates the illusion
      // of diving into the system without any visible pop.
      const entryScale = trans.systemScaleAtEntry;
      const fullScaleR = trans.systemFullScaleRadius;
      const fadeEndR = trans.systemFadeEnd;

      let sysScale: number;
      if (camRadius >= fadeEndR) {
        // Still fading in — scale ramps from ~0 to entryScale with blend
        sysScale = entryScale * this.blend;
      } else if (camRadius <= fullScaleR) {
        // Fully zoomed in — full scale
        sysScale = 1.0;
      } else {
        // Between fade-end and full-scale radius: interpolate entryScale → 1.0
        const t = 1 - (camRadius - fullScaleR) / (fadeEndR - fullScaleR);
        const eased = t * t * (3 - 2 * t); // smoothstep
        sysScale = entryScale + (1.0 - entryScale) * eased;
      }

      sys.root.scaling.setAll(sysScale);
      // Scale light range proportionally so illumination stays correct
      sys.light.range = 50 * sysScale;

      // Tick orbits only when visible
      if (this.blend > 0.01) {
        sys.orbitSystem.update(dt);
        sys.starMesh.rotation.y += 0.05 * dt;
      }
    }

    // ── System focus camera constraint ──
    if (focusStar && this.blend > 0.05) {
      this.cam.setSystemFocus(
        new Vector3(focusStar.x, 0, focusStar.z),
        trans.systemBorderRadius,
        this.blend,
      );
    } else {
      this.cam.clearSystemFocus();
    }
  }

  /* ─────────────────── Phase management ─────────────────── */

  private updatePhase(focusStar: StarData | null): void {
    const prevPhase = this.phase;

    if (this.blend <= 0) {
      this.phase = TransitionPhase.GALAXY;
      // Fully in galaxy — unlock target
      this.lockedStarId = -1;
    } else if (this.blend >= 1) {
      this.phase = TransitionPhase.IN_SYSTEM;
    } else if (this.blend > 0 && prevPhase === TransitionPhase.GALAXY) {
      // Just started zooming in
      this.phase = TransitionPhase.ZOOMING_IN;
      if (focusStar) {
        this.lockedStarId = focusStar.id;
      }
    } else if (prevPhase === TransitionPhase.IN_SYSTEM) {
      // Started zooming out
      this.phase = TransitionPhase.ZOOMING_OUT;
    }
    // Otherwise maintain current phase (ZOOMING_IN or ZOOMING_OUT)

    // Lock target on first zoom-in contact regardless of phase transitions
    if (focusStar && this.lockedStarId < 0 && this.blend > GALAXY_MAP.transition.lockBlendThreshold) {
      this.lockedStarId = focusStar.id;
    }
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
    starMesh.visibility = 0;
    this.glowLayer.addIncludedOnlyMesh(starMesh);

    // ── Point light at star center ──
    const light = new PointLight(`light_${star.id}`, Vector3.Zero(), this.scene);
    light.parent = root;
    light.intensity = 0;
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
      mesh.visibility = 0;
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
    this.disposeActiveSystem();
    this.starField.dispose();
    this.cam.dispose();
    this.scene.dispose();
  }
}
