import { GALAXY_MAP } from "./GalaxyMap";

const PLAYER_SHIP_SEED_SALT = 0x6c8e9cf5;

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getPlayerShipStarId(
  starCount = GALAXY_MAP.starCount,
  seed = GALAXY_MAP.seed,
): number {
  if (starCount <= 0) return -1;
  const rng = mulberry32(seed ^ PLAYER_SHIP_SEED_SALT);
  return Math.floor(rng() * starCount);
}

export function isPlayerShipSystem(starId: number, starCount = GALAXY_MAP.starCount): boolean {
  return starId === getPlayerShipStarId(starCount);
}
