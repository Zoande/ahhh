/**
 * StarFieldRenderer
 * Renders all stars as billboard sprites using Babylon's SpriteManager.
 * Single draw call for all stars. Each star gets its own color, size, and position.
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

/** Multiplier from star luminosity to sprite world-unit size */
const GLOW_SIZE_FACTOR = 4;

export class StarFieldRenderer {
  private spriteManager: SpriteManager;
  private sprites: Sprite[] = [];
  private baseColors: Color4[] = [];
  private baseSizes: number[] = [];   // base width/height per star
  private starPositions: Array<{ x: number; z: number }> = [];

  // Current per-star overrides (applied each frame via applyVisuals)
  private alphaOverrides: Float32Array;
  private scaleOverrides: Float32Array;

  constructor(scene: Scene, stars: StarData[]) {
    this.spriteManager = new SpriteManager(
      "starSprites",
      "/textures/star.glow.png",
      stars.length,
      { width: 256, height: 256 },
      scene,
    );
    this.spriteManager.isPickable = false;

    // Use additive blending for a natural glow look
    this.spriteManager.blendMode = 1; // ALPHA_ADD

    this.alphaOverrides = new Float32Array(stars.length).fill(1);
    this.scaleOverrides = new Float32Array(stars.length).fill(1);

    for (const star of stars) {
      const sprite = new Sprite(`star_${star.id}`, this.spriteManager);
      sprite.position = new Vector3(star.x, 0, star.z);

      const size = star.luminosity * GLOW_SIZE_FACTOR;
      sprite.width = size;
      sprite.height = size;

      const c = new Color4(star.color[0], star.color[1], star.color[2], 1);
      sprite.color = c;

      this.sprites.push(sprite);
      this.baseColors.push(c.clone());
      this.baseSizes.push(size);
      this.starPositions.push({ x: star.x, z: star.z });
    }
  }

  /* ─── Per-star low-level overrides ─── */

  /** Set alpha for a specific star (0 = invisible, 1 = full). */
  setStarAlpha(starId: number, alpha: number): void {
    if (starId >= 0 && starId < this.sprites.length) {
      this.alphaOverrides[starId] = alpha;
    }
  }

  /** Set scale for a specific star's glow (1 = normal, 0 = invisible). */
  setStarScale(starId: number, scale: number): void {
    if (starId >= 0 && starId < this.sprites.length) {
      this.scaleOverrides[starId] = scale;
    }
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
    if (focusStarId < 0 || focusStarId >= this.sprites.length) return;

    const cx = this.starPositions[focusStarId].x;
    const cz = this.starPositions[focusStarId].z;
    const rSq = radius * radius;

    for (let i = 0; i < this.sprites.length; i++) {
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
    for (let i = 0; i < this.sprites.length; i++) {
      const base = this.baseColors[i];
      const a = this.alphaOverrides[i];
      const s = this.scaleOverrides[i];
      const baseSize = this.baseSizes[i];

      this.sprites[i].color = new Color4(base.r, base.g, base.b, a);
      this.sprites[i].width = baseSize * s;
      this.sprites[i].height = baseSize * s;
    }
  }

  dispose(): void {
    this.spriteManager.dispose();
    this.sprites = [];
    this.baseColors = [];
    this.baseSizes = [];
    this.starPositions = [];
  }
}
