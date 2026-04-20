/**
 * StarFieldRenderer
 * Renders all stars as layered billboard sprites using Babylon's SpriteManager.
 * Each star gets two sprites:
 * - soft halo (broad additive falloff)
 * - bright core (tight highlight)
 *
 * Supports:
 * - Per-star alpha for smooth transitions
 * - Per-star scale for highlight / shrink effects
 * - Neighbor suppression: fade + shrink nearby stars during system focus
 * - Batch restore for reverse transitions
 */

import { SpriteManager, Sprite, Vector3, Color4 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { StarData } from "../data/StarMap";

const SPRITE_BLEND_ADD = 1; // ALPHA_ADD
const STAR_TEXTURE_SIZE = 128;

/** Multiplier from star luminosity to sprite world-unit size */
const CORE_SIZE_FACTOR = 1.8;
const HALO_SIZE_FACTOR = 6.2;

/** How strongly star type colors are preserved (0 = white, 1 = full color). */
const TINT_STRENGTH = 0.34;

const CORE_BASE_ALPHA = 0.95;
const HALO_BASE_ALPHA = 0.38;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function softenColor(color: [number, number, number]): Color4 {
  return new Color4(
    mix(1, color[0], TINT_STRENGTH),
    mix(1, color[1], TINT_STRENGTH),
    mix(1, color[2], TINT_STRENGTH),
    1,
  );
}

function createRadialTextureDataURL(
  size: number,
  middleStop: number,
  edgeStop: number,
  middleAlpha: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Transparent 1x1 fallback if canvas context is unavailable.
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY0x6sAAAAAElFTkSuQmCC";
  }

  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(middleStop, `rgba(255,255,255,${middleAlpha})`);
  grad.addColorStop(edgeStop, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return canvas.toDataURL("image/png");
}

export class StarFieldRenderer {
  private haloManager: SpriteManager;
  private coreManager: SpriteManager;
  private haloSprites: Sprite[] = [];
  private coreSprites: Sprite[] = [];
  private baseColors: Color4[] = [];
  private baseCoreSizes: number[] = [];
  private baseHaloSizes: number[] = [];
  private starPositions: Array<{ x: number; z: number }> = [];

  // Current per-star overrides (applied each frame via applyVisuals)
  private alphaOverrides: Float32Array;
  private scaleOverrides: Float32Array;
  private zoomOutBlend = 1;

  constructor(scene: Scene, stars: StarData[]) {
    const haloTexture = createRadialTextureDataURL(STAR_TEXTURE_SIZE, 0.35, 0.78, 0.34);
    const coreTexture = createRadialTextureDataURL(STAR_TEXTURE_SIZE, 0.07, 0.33, 0.92);

    this.haloManager = new SpriteManager(
      "starHaloSprites",
      haloTexture,
      stars.length,
      { width: STAR_TEXTURE_SIZE, height: STAR_TEXTURE_SIZE },
      scene,
    );

    this.coreManager = new SpriteManager(
      "starCoreSprites",
      coreTexture,
      stars.length,
      { width: STAR_TEXTURE_SIZE, height: STAR_TEXTURE_SIZE },
      scene,
    );

    this.haloManager.isPickable = false;
    this.coreManager.isPickable = false;

    this.haloManager.fogEnabled = false;
    this.coreManager.fogEnabled = false;

    // Use additive blending for a natural glow look
    this.haloManager.blendMode = SPRITE_BLEND_ADD;
    this.coreManager.blendMode = SPRITE_BLEND_ADD;

    this.alphaOverrides = new Float32Array(stars.length).fill(1);
    this.scaleOverrides = new Float32Array(stars.length).fill(1);

    for (const star of stars) {
      const halo = new Sprite(`star_halo_${star.id}`, this.haloManager);
      const core = new Sprite(`star_core_${star.id}`, this.coreManager);

      const pos = new Vector3(star.x, 0, star.z);
      halo.position = pos.clone();
      core.position = pos;

      const coreSize = star.luminosity * CORE_SIZE_FACTOR;
      const haloSize = star.luminosity * HALO_SIZE_FACTOR;
      core.width = coreSize;
      core.height = coreSize;
      halo.width = haloSize;
      halo.height = haloSize;

      const c = softenColor(star.color);
      core.color = new Color4(c.r, c.g, c.b, CORE_BASE_ALPHA);
      halo.color = new Color4(c.r, c.g, c.b, HALO_BASE_ALPHA);

      this.coreSprites.push(core);
      this.haloSprites.push(halo);
      this.baseColors.push(c.clone());
      this.baseCoreSizes.push(coreSize);
      this.baseHaloSizes.push(haloSize);
      this.starPositions.push({ x: star.x, z: star.z });
    }
  }

  /* ─── Per-star low-level overrides ─── */

  /** Set alpha for a specific star (0 = invisible, 1 = full). */
  setStarAlpha(starId: number, alpha: number): void {
    if (starId >= 0 && starId < this.coreSprites.length) {
      this.alphaOverrides[starId] = alpha;
    }
  }

  /** Set scale for a specific star's glow (1 = normal, 0 = invisible). */
  setStarScale(starId: number, scale: number): void {
    if (starId >= 0 && starId < this.coreSprites.length) {
      this.scaleOverrides[starId] = scale;
    }
  }

  /**
   * Set zoom blend where 0 = fully zoomed-in and 1 = fully zoomed-out.
   * At higher values stars get larger and brighter for map readability.
   */
  setZoomOutBlend(zoomOutBlend: number): void {
    this.zoomOutBlend = clamp01(zoomOutBlend);
  }

  /* ─── Neighbor suppression ─── */

  /**
   * Suppress (fade + shrink) all stars within `radius` of the focus star.
   * @param focusStarId  The star being zoomed into (excluded from suppression).
   * @param radius       World-unit radius around the focus star.
   * @param strength     0 = no suppression, 1 = full suppression.
   * @param minAlpha     Floor alpha for suppressed stars (so they don't fully vanish).
   * @param shrinkFactor At full strength, scale becomes this (e.g. 0.3 = 30% size).
   */
  suppressNeighbors(
    focusStarId: number,
    radius: number,
    strength: number,
    minAlpha = 0.05,
    shrinkFactor = 0.3,
  ): void {
    if (focusStarId < 0 || focusStarId >= this.coreSprites.length) return;

    const cx = this.starPositions[focusStarId].x;
    const cz = this.starPositions[focusStarId].z;
    const rSq = radius * radius;

    for (let i = 0; i < this.coreSprites.length; i++) {
      if (i === focusStarId) continue;

      const dx = this.starPositions[i].x - cx;
      const dz = this.starPositions[i].z - cz;
      const distSq = dx * dx + dz * dz;

      if (distSq < rSq) {
        // Distance-based falloff: closer neighbors get suppressed more
        const dist = Math.sqrt(distSq);
        const proximity = 1 - dist / radius; // 1 at center, 0 at edge
        const localStrength = strength * proximity;

        const targetAlpha = 1 - localStrength * (1 - minAlpha);
        const targetScale = 1 - localStrength * (1 - shrinkFactor);

        // Only suppress, never boost — take min with current
        this.alphaOverrides[i] = Math.min(this.alphaOverrides[i], targetAlpha);
        this.scaleOverrides[i] = Math.min(this.scaleOverrides[i], targetScale);
      }
    }
  }

  /**
   * Reset all star overrides to defaults (alpha=1, scale=1).
   * Call at the start of each frame before applying new suppression.
   */
  resetOverrides(): void {
    this.alphaOverrides.fill(1);
    this.scaleOverrides.fill(1);
  }

  /**
   * Apply all alpha + scale overrides to actual sprite visuals.
   * Call once per frame after all suppression / per-star changes are set.
   */
  applyVisuals(): void {
    const coreScaleBoost = mix(1.0, 1.45, this.zoomOutBlend);
    const haloScaleBoost = mix(1.0, 2.2, this.zoomOutBlend);
    const coreAlphaBoost = mix(0.9, 1.25, this.zoomOutBlend);
    const haloAlphaBoost = mix(1.0, 2.2, this.zoomOutBlend);

    for (let i = 0; i < this.coreSprites.length; i++) {
      const base = this.baseColors[i];
      const a = this.alphaOverrides[i];
      const s = this.scaleOverrides[i];
      const coreSize = this.baseCoreSizes[i];
      const haloSize = this.baseHaloSizes[i];

      const core = this.coreSprites[i];
      const halo = this.haloSprites[i];

      core.width = coreSize * s * coreScaleBoost;
      core.height = coreSize * s * coreScaleBoost;
      halo.width = haloSize * s * haloScaleBoost;
      halo.height = haloSize * s * haloScaleBoost;

      core.color.set(base.r, base.g, base.b, clamp01(CORE_BASE_ALPHA * a * coreAlphaBoost));
      halo.color.set(base.r, base.g, base.b, clamp01(HALO_BASE_ALPHA * a * haloAlphaBoost));
    }
  }

  dispose(): void {
    this.haloManager.dispose();
    this.coreManager.dispose();
    this.haloSprites = [];
    this.coreSprites = [];
    this.baseColors = [];
    this.baseCoreSizes = [];
    this.baseHaloSizes = [];
    this.starPositions = [];
  }
}
