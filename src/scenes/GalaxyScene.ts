/**
 * GalaxyScene
 * Pure galaxy-map view with stars and camera controls.
 * Clicking a star requests navigation into a separate SystemScene.
 */

import {
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Texture,
  PointerEventTypes,
} from "@babylonjs/core";
import type { AbstractEngine, Mesh, Observer, PointerInfo } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { GALAXY_MAP } from "../data/GalaxyMap";
import { generateStarMap } from "../data/StarMap";
import type { StarData } from "../data/StarMap";
import { CameraController } from "../systems/CameraController";
import { StarFieldRenderer } from "../systems/StarFieldRenderer";

type EnterSystemHandler = (star: StarData) => void | Promise<void>;

export interface GalaxyViewState {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface GalaxySceneOptions {
  stars?: StarData[];
  initialViewState?: GalaxyViewState;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type CoreTextureShape = {
  innerRadiusFraction: number;
  outerRadiusFraction: number;
  spiralArms: number;
  spiralTightness: number;
  armSpread: number;
};

function createGalacticCoreTextureDataURL(
  size: number,
  shape: CoreTextureShape,
  axisRatio: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY0x6sAAAAAElFTkSuQmCC";
  }

  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  const majorStretch = Math.max(1.05, Math.min(1.34, axisRatio * 0.88));
  const minorStretch = Math.max(0.74, Math.min(0.98, 1 / (majorStretch * 0.96)));
  const armCount = Math.max(2, shape.spiralArms);
  const armTightness = Math.max(1.35, shape.spiralTightness);
  const armSpread = Math.max(0.12, shape.armSpread);

  // Keep the core physically broad, but make brightness drop much faster.
  const decayRadius =
    c
    * Math.max(0.56, Math.min(0.74, shape.innerRadiusFraction * 1.9 + 0.18));
  const shoulderRadius = c * Math.max(0.78, Math.min(0.96, decayRadius / c + 0.26));

  const base = ctx.createRadialGradient(c, c, 0, c, c, decayRadius);
  base.addColorStop(0, "rgba(255,244,220,1)");
  base.addColorStop(0.08, "rgba(255,230,196,0.84)");
  base.addColorStop(0.2, "rgba(255,208,160,0.46)");
  base.addColorStop(0.36, "rgba(255,187,138,0.17)");
  base.addColorStop(0.52, "rgba(255,170,120,0.05)");
  base.addColorStop(1, "rgba(255,164,116,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const diffuse = ctx.createRadialGradient(c, c, decayRadius * 0.68, c, c, shoulderRadius);
  diffuse.addColorStop(0, "rgba(255,224,186,0)");
  diffuse.addColorStop(0.52, "rgba(255,188,134,0.08)");
  diffuse.addColorStop(1, "rgba(255,176,124,0)");
  ctx.fillStyle = diffuse;
  ctx.fillRect(0, 0, size, size);

  const rng = mulberry32(7331);
  ctx.globalCompositeOperation = "screen";

  // Irregular warm cloud field with mixed directional drift.
  // Still favors galaxy elongation, but spreads into diagonal/vertical directions too.
  for (let i = 0; i < 360; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 1.85) * size * 0.46;
    const directionMode = rng();
    let dirX = 0;
    let dirY = 0;
    if (directionMode < 0.46) {
      dirX = (rng() < 0.5 ? -1 : 1) * (0.42 + rng() * 0.58);
      dirY = (rng() - 0.5) * 0.48;
    } else if (directionMode < 0.78) {
      dirX = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.54);
      dirY = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.54);
    } else {
      dirX = (rng() - 0.5) * 0.44;
      dirY = (rng() < 0.5 ? -1 : 1) * (0.44 + rng() * 0.56);
    }
    const dirPull = size * (0.004 + rng() * 0.048) * (0.4 + r / (size * 0.46));
    const x =
      c
      + Math.cos(ang) * r * majorStretch
      + dirX * dirPull;
    const y =
      c
      + Math.sin(ang) * r * minorStretch * (0.72 + rng() * 0.28)
      + dirY * dirPull * 0.92
      + Math.sin(ang * (1.2 + rng() * 0.8)) * size * 0.01;
    const blobRadius = size * (0.01 + rng() * 0.09);
    const alpha = 0.02 + rng() * 0.11 + (1 - r / (size * 0.46)) * 0.07;
    const warmR = 255;
    const warmG = 204 + Math.floor(rng() * 36);
    const warmB = 150 + Math.floor(rng() * 40);

    const blob = ctx.createRadialGradient(x, y, 0, x, y, blobRadius);
    blob.addColorStop(0, `rgba(${warmR},${warmG},${warmB},${alpha})`);
    blob.addColorStop(1, `rgba(${warmR},${warmG},${warmB},0)`);

    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, blobRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Secondary isotropic plume layer to spread energy off the major axis.
  for (let i = 0; i < 120; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 1.55) * size * 0.4;
    const radialWarp = 0.88 + rng() * 0.28;
    const x = c + Math.cos(ang) * r * radialWarp;
    const y = c + Math.sin(ang) * r * radialWarp;
    const rr = size * (0.012 + rng() * 0.065);
    const alpha = 0.012 + rng() * 0.055;
    const plume = ctx.createRadialGradient(x, y, 0, x, y, rr);
    plume.addColorStop(0, `rgba(255,198,142,${alpha})`);
    plume.addColorStop(1, "rgba(255,174,120,0)");
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "lighter";
  // Arm-like wisps anchored to galaxy settings, with jitter so it does not look ringed/even.
  for (let arm = 0; arm < armCount; arm++) {
    const strands = 4 + Math.floor(rng() * 3);
    for (let s = 0; s < strands; s++) {
      const phase = (arm / armCount) * Math.PI * 2 + (rng() - 0.5) * 0.48;
      const jitterA = rng() * Math.PI * 2;
      const jitterB = rng() * Math.PI * 2;
      const wobbleAmp = size * (0.004 + rng() * 0.012);
      const lineAlpha = 0.018 + rng() * 0.035;
      const armLength = size * (0.24 + rng() * 0.34);
      const sideSkew = rng() < 0.68 ? 1 : -1;
      const verticalSkew = (rng() < 0.5 ? -1 : 1) * size * (0.004 + rng() * 0.01);
      ctx.lineWidth = Math.max(1, size * (0.0014 + rng() * 0.0032));
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.015) {
        const swirl = t * armTightness * Math.PI + Math.sin(t * 7 + jitterA) * 0.18;
        const rr = Math.pow(t, 1.25) * armLength;
        const scatter = Math.sin(t * 15 + jitterB) * wobbleAmp * (0.5 + t);
        const sidePull = sideSkew * size * 0.014 * t * t;
        const x = c + Math.cos(phase + swirl) * rr * majorStretch + scatter + sidePull;
        const y =
          c
          + Math.sin(phase + swirl) * rr * minorStretch
          + Math.cos(t * 11 + jitterA * 0.7) * wobbleAmp * 0.8
          + Math.sin(t * 6 + jitterB) * size * armSpread * 0.009
          + verticalSkew * t * t;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(255,204,150,${lineAlpha})`;
      ctx.stroke();
    }
  }

  // Mixed-direction drifting veils break ring cues while spreading beyond horizontal.
  for (let i = 0; i < 34; i++) {
    const dirMode = rng();
    let angle: number;
    if (dirMode < 0.42) {
      angle = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.56;
    } else if (dirMode < 0.76) {
      angle = (rng() < 0.5 ? Math.PI / 4 : -Math.PI / 4) + (rng() - 0.5) * 0.68;
    } else {
      angle = (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.58;
    }

    const perp = angle + Math.PI / 2;
    const startRadius = size * (0.03 + rng() * 0.09);
    const length = size * (0.14 + rng() * 0.28);
    const bend = size * (0.05 + rng() * 0.18);

    const startX = c + Math.cos(angle + (rng() - 0.5) * 0.8) * startRadius;
    const startY = c + Math.sin(angle + (rng() - 0.5) * 0.8) * startRadius;
    const endX = startX + Math.cos(angle) * length + Math.cos(perp) * (rng() - 0.5) * bend;
    const endY = startY + Math.sin(angle) * length + Math.sin(perp) * (rng() - 0.5) * bend;
    const cpX = c + Math.cos(angle) * length * (0.45 + rng() * 0.22);
    const cpY = c + Math.sin(angle) * length * (0.45 + rng() * 0.22);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.strokeStyle = `rgba(255,194,140,${0.011 + rng() * 0.024})`;
    ctx.lineWidth = size * (0.003 + rng() * 0.008);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Carve uneven dust channels and pits to destroy concentric ring cues.
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 24; i++) {
    const laneRadius = size * (0.08 + rng() * 0.3);
    const laneStart = rng() * Math.PI * 2;
    const laneSweep = (0.2 + rng() * 0.55) * Math.PI;
    const laneWidth = size * (0.006 + rng() * 0.018);

    ctx.save();
    ctx.translate(c + (rng() - 0.35) * size * 0.08, c + (rng() - 0.5) * size * 0.08);
    ctx.rotate((rng() - 0.5) * 0.9);
    ctx.scale(majorStretch * (0.86 + rng() * 0.24), minorStretch * (0.72 + rng() * 0.28));
    ctx.beginPath();
    ctx.arc(0, 0, laneRadius, laneStart, laneStart + laneSweep);
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + rng() * 0.07})`;
    ctx.lineWidth = laneWidth;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < 32; i++) {
    const x = c + (rng() - 0.5) * size * 0.8;
    const y = c + (rng() - 0.5) * size * 0.56;
    const rr = size * (0.01 + rng() * 0.04);
    const pit = ctx.createRadialGradient(x, y, 0, x, y, rr);
    pit.addColorStop(0, `rgba(0,0,0,${0.04 + rng() * 0.09})`);
    pit.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pit;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Keep center punchy while the outer glow fades quickly.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 2.5) * size * 0.11;
    const x = c + Math.cos(ang) * r * majorStretch;
    const y = c + Math.sin(ang) * r * minorStretch;
    const rr = size * (0.016 + rng() * 0.04);
    const knot = ctx.createRadialGradient(x, y, 0, x, y, rr);
    knot.addColorStop(0, `rgba(255,240,208,${0.16 + rng() * 0.2})`);
    knot.addColorStop(1, "rgba(255,224,182,0)");
    ctx.fillStyle = knot;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Keep very faint asymmetrical haze with multi-direction distribution.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24; i++) {
    const mode = rng();
    let ang: number;
    if (mode < 0.45) {
      ang = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.7;
    } else if (mode < 0.76) {
      ang = (rng() < 0.5 ? Math.PI / 3 : -Math.PI / 3) + (rng() - 0.5) * 0.78;
    } else {
      ang = (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.64;
    }
    const radial = size * (0.1 + rng() * 0.28);
    const x = c + Math.cos(ang) * radial * (0.92 + rng() * 0.24);
    const y = c + Math.sin(ang) * radial * (0.92 + rng() * 0.24);
    const rr = size * (0.08 + rng() * 0.16);
    const haze = ctx.createRadialGradient(x, y, 0, x, y, rr);
    haze.addColorStop(0, `rgba(255,184,128,${0.015 + rng() * 0.03})`);
    haze.addColorStop(1, "rgba(255,166,112,0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/png");
}

export class GalaxyScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private canvas!: HTMLCanvasElement;
  private cam!: CameraController;
  private starField!: StarFieldRenderer;
  private stars: StarData[] = [];
  private clickPlane!: Mesh;
  private galacticCoreMeshes: Mesh[] = [];
  private galacticCoreSpinSpeeds: number[] = [];
  private pointerObserver: Observer<PointerInfo> | null = null;
  private isNavigating = false;
  private readonly onEnterSystem: EnterSystemHandler;
  private readonly options: GalaxySceneOptions;

  private readonly onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  constructor(
    engine: AbstractEngine,
    onEnterSystem: EnterSystemHandler,
    options?: GalaxySceneOptions,
  ) {
    this.engine = engine;
    this.onEnterSystem = onEnterSystem;
    this.options = options ?? {};
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
  }

  async setup(): Promise<void> {
    this.canvas = this.engine.getRenderingCanvas()!;
    this.canvas.addEventListener("contextmenu", this.onContextMenu);

    const cfg = GALAXY_MAP;
    this.stars =
      this.options.stars && this.options.stars.length > 0
        ? this.options.stars
        : generateStarMap(
          cfg.width,
          cfg.height,
          cfg.starCount,
          cfg.seed,
          cfg.minStarSpacing,
          cfg.shape,
        );

    const initialViewState = this.options.initialViewState;

    this.cam = new CameraController(this.scene, this.canvas, {
      alpha: initialViewState?.alpha ?? cfg.camera.startAlpha,
      beta: initialViewState?.beta ?? cfg.camera.startBeta,
      radius: initialViewState?.radius ?? cfg.camera.startRadius,
      target: initialViewState
        ? new Vector3(
          initialViewState.targetX,
          initialViewState.targetY,
          initialViewState.targetZ,
        )
        : Vector3.Zero(),
      lowerRadiusLimit: cfg.camera.minRadius,
      upperRadiusLimit: cfg.camera.maxRadius,
      lowerBetaLimit: cfg.camera.minBeta,
      upperBetaLimit: cfg.camera.maxBeta,
      wheelDeltaPercentage: cfg.camera.wheelDeltaPercentage,
      inertia: cfg.camera.inertia,
    });

    this.cam.setBounds(
      -cfg.width / 2,
      cfg.width / 2,
      -cfg.height / 2,
      cfg.height / 2,
    );

    this.clickPlane = MeshBuilder.CreateGround(
      "galaxyClickPlane",
      { width: cfg.width * 1.5, height: cfg.height * 1.5 },
      this.scene,
    );
    this.clickPlane.isVisible = false;
    this.clickPlane.isPickable = true;

    const bgSphere = MeshBuilder.CreateSphere(
      "galaxyBackground",
      { diameter: 5000, segments: 24 },
      this.scene,
    );
    const bgMat = new StandardMaterial("galaxyBackgroundMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.png", this.scene);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgSphere.material = bgMat;
    bgSphere.isPickable = false;
    bgSphere.infiniteDistance = true;

    this.setupGalacticCore(cfg.width, cfg.height);

    this.starField = new StarFieldRenderer(this.scene, this.stars);

    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const ev = pointerInfo.event as PointerEvent;
      if (ev.button !== 0) return;
      if (this.isNavigating) return;
      this.tryEnterSystemAtPointer();
    });

    await this.scene.whenReadyAsync();
  }

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    this.cam.updatePanning(dt);

    const camera = this.cam.camera;
    const minRadius = camera.lowerRadiusLimit ?? GALAXY_MAP.camera.minRadius;
    const maxRadius = camera.upperRadiusLimit ?? GALAXY_MAP.camera.maxRadius;
    const zoomOutBlend =
      (this.cam.radius - minRadius) / Math.max(0.0001, maxRadius - minRadius);

    this.starField.update(dt);
    this.starField.resetOverrides();
    this.starField.setZoomOutBlend(zoomOutBlend);
    this.starField.applyVisuals();

    for (let i = 0; i < this.galacticCoreMeshes.length; i++) {
      this.galacticCoreMeshes[i].rotation.y += this.galacticCoreSpinSpeeds[i] * dt;
    }
  }

  private setupGalacticCore(width: number, height: number): void {
    const minSize = Math.min(width, height);
    const axisRatio = width / Math.max(1, height);
    const coreTextureDataURL = createGalacticCoreTextureDataURL(
      1024,
      GALAXY_MAP.shape,
      axisRatio,
    );
    const majorScale = Math.max(1.08, Math.min(1.32, axisRatio * 0.88));
    const minorScale = Math.max(0.76, Math.min(0.98, 1 / (majorScale * 0.96)));

    const layers = [
      {
        name: "galaxyCoreOuter",
        radius: minSize * 0.62,
        alpha: 0.065,
        color: new Color3(1.0, 0.69, 0.47),
        spin: 0.0019,
        scaleX: majorScale * 1.03,
        scaleZ: minorScale * 1.1,
        offsetX: minSize * 0.012,
        offsetZ: -minSize * 0.016,
        yaw: 0.11,
        texScale: 1.02,
        texOffsetU: -0.012,
        texOffsetV: 0.01,
      },
      {
        name: "galaxyCoreMid",
        radius: minSize * 0.49,
        alpha: 0.115,
        color: new Color3(1.0, 0.74, 0.51),
        spin: -0.0036,
        scaleX: majorScale * 0.99,
        scaleZ: minorScale * 1.07,
        offsetX: -minSize * 0.008,
        offsetZ: minSize * 0.014,
        yaw: -0.15,
        texScale: 1.0,
        texOffsetU: 0.007,
        texOffsetV: -0.013,
      },
      {
        name: "galaxyCoreInner",
        radius: minSize * 0.35,
        alpha: 0.195,
        color: new Color3(1.0, 0.81, 0.6),
        spin: 0.0058,
        scaleX: majorScale * 0.94,
        scaleZ: minorScale * 0.99,
        offsetX: minSize * 0.004,
        offsetZ: minSize * 0.009,
        yaw: 0.08,
        texScale: 0.985,
        texOffsetU: -0.004,
        texOffsetV: 0.011,
      },
      {
        name: "galaxyCoreNucleus",
        radius: minSize * 0.24,
        alpha: 0.285,
        color: new Color3(1.0, 0.88, 0.7),
        spin: -0.0105,
        scaleX: majorScale * 0.89,
        scaleZ: minorScale * 0.92,
        offsetX: -minSize * 0.003,
        offsetZ: -minSize * 0.006,
        yaw: -0.06,
        texScale: 0.97,
        texOffsetU: 0.003,
        texOffsetV: -0.007,
      },
    ];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const disc = MeshBuilder.CreateDisc(
        layer.name,
        { radius: layer.radius, tessellation: 96 },
        this.scene,
      );
      disc.rotation.x = Math.PI / 2;
      disc.rotation.z = layer.yaw;
      disc.position.y = 0.02 + i * 0.01;
      disc.position.x = layer.offsetX;
      disc.position.z = layer.offsetZ;
      disc.scaling.x = layer.scaleX;
      disc.scaling.y = layer.scaleZ;
      disc.isPickable = false;

      const layerTexture = new Texture(coreTextureDataURL, this.scene);
      layerTexture.hasAlpha = true;
      layerTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      layerTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
      layerTexture.uScale = layer.texScale;
      layerTexture.vScale = layer.texScale * (0.97 + i * 0.012);
      layerTexture.uOffset = layer.texOffsetU;
      layerTexture.vOffset = layer.texOffsetV;

      const mat = new StandardMaterial(`${layer.name}Mat`, this.scene);
      mat.emissiveTexture = layerTexture;
      mat.opacityTexture = layerTexture;
      mat.emissiveColor = layer.color;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = layer.alpha;

      disc.material = mat;
      this.galacticCoreMeshes.push(disc);
      this.galacticCoreSpinSpeeds.push(layer.spin);
    }
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
    const pickRadius = Math.max(16, this.cam.radius * 0.035);
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
    this.requestEnterSystem(nearestStar);
  }

  private requestEnterSystem(star: StarData): void {
    if (this.isNavigating) return;
    this.isNavigating = true;
    Promise.resolve(this.onEnterSystem(star))
      .catch((err) => console.error("Failed to open system view", err))
      .finally(() => {
        this.isNavigating = false;
      });
  }

  getStars(): StarData[] {
    return this.stars;
  }

  captureViewState(): GalaxyViewState | null {
    if (!this.cam) return null;

    const target = this.cam.target;
    return {
      alpha: this.cam.camera.alpha,
      beta: this.cam.camera.beta,
      radius: this.cam.radius,
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    };
  }

  dispose(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.canvas?.removeEventListener("contextmenu", this.onContextMenu);
    this.galacticCoreMeshes = [];
    this.galacticCoreSpinSpeeds = [];
    this.clickPlane?.dispose();
    this.starField?.dispose();
    this.cam?.dispose();
    this.scene.dispose();
  }
}
