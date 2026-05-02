import { GALAXY_MAP } from "./GalaxyMap";

const STARBASE_SEED_SALT = 0x7f3e6d42;  // Different salt than player ship

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Get the star ID where the friendly starbase is located.
 * Uses deterministic seeding to ensure consistent placement.
 */
export function getStarbaseStarId(
  starCount = GALAXY_MAP.starCount,
  seed = GALAXY_MAP.seed,
): number {
  if (starCount <= 0) return -1;
  const rng = mulberry32(seed ^ STARBASE_SEED_SALT);
  return Math.floor(rng() * starCount);
}

/**
 * Check if this star system has a starbase.
 */
export function isStarbaseSystem(starId: number, starCount = GALAXY_MAP.starCount): boolean {
  return starId === getStarbaseStarId(starCount);
}
