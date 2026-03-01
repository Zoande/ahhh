/**
 * StarMap — Star type definitions and procedural star generation.
 * Generates a deterministic field of stars using a seeded PRNG.
 * Each star has a spectral type, color, luminosity, position, and placeholder system config.
 */

/* ═══════════════════════ Star spectral types ═══════════════════════ */

export enum StarType {
  O = "O", // Blue giant — very rare, very bright
  B = "B", // Blue-white — rare, bright
  A = "A", // White — uncommon
  F = "F", // Yellow-white
  G = "G", // Yellow (Sol-like)
  K = "K", // Orange
  M = "M", // Red dwarf — most common, dimmest
}

export interface StarTypeConfig {
  /** Base RGB color [0-1] */
  color: [number, number, number];
  /** Visual luminosity range (affects glow sprite size) */
  luminosityMin: number;
  luminosityMax: number;
  /** Spawn probability weight */
  weight: number;
  /** Star surface mesh diameter when in system view */
  systemDiameter: number;
}

export const STAR_TYPES: Record<StarType, StarTypeConfig> = {
  [StarType.O]: {
    color: [0.6, 0.7, 1.0],
    luminosityMin: 1.8, luminosityMax: 2.5,
    weight: 1,
    systemDiameter: 7.0,
  },
  [StarType.B]: {
    color: [0.7, 0.8, 1.0],
    luminosityMin: 1.4, luminosityMax: 2.0,
    weight: 3,
    systemDiameter: 6.0,
  },
  [StarType.A]: {
    color: [0.9, 0.92, 1.0],
    luminosityMin: 1.1, luminosityMax: 1.6,
    weight: 6,
    systemDiameter: 5.5,
  },
  [StarType.F]: {
    color: [1.0, 0.96, 0.85],
    luminosityMin: 0.9, luminosityMax: 1.3,
    weight: 10,
    systemDiameter: 5.0,
  },
  [StarType.G]: {
    color: [1.0, 0.92, 0.7],
    luminosityMin: 0.8, luminosityMax: 1.1,
    weight: 15,
    systemDiameter: 5.0,
  },
  [StarType.K]: {
    color: [1.0, 0.75, 0.45],
    luminosityMin: 0.5, luminosityMax: 0.9,
    weight: 25,
    systemDiameter: 4.5,
  },
  [StarType.M]: {
    color: [1.0, 0.55, 0.3],
    luminosityMin: 0.3, luminosityMax: 0.6,
    weight: 40,
    systemDiameter: 4.0,
  },
};

/* ═══════════════════════ Per-star data interfaces ═══════════════════════ */

export interface PlanetConfig {
  type: "rocky" | "gas" | "ice";
  diameter: number;
  orbitRadius: number;
  orbitSpeed: number;
}

export interface StarSystemConfig {
  planets: PlanetConfig[];
}

export interface StarData {
  id: number;
  name: string;
  type: StarType;
  x: number;
  z: number;
  luminosity: number;
  /** Per-star color (slightly varied from type base color) */
  color: [number, number, number];
  system: StarSystemConfig;
}

/* ═══════════════════════ Seeded PRNG (Mulberry32) ═══════════════════════ */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════ Name generator ═══════════════════════ */

const NAME_PREFIXES = [
  "Al", "Be", "Ca", "De", "El", "Fa", "Ga", "Ha", "Ir", "Ja",
  "Ka", "Le", "Ma", "Na", "Or", "Pa", "Qu", "Ra", "Sa", "Ta",
  "Ul", "Va", "Wa", "Xa", "Za", "An", "Br", "Cr", "Dr", "Er",
  "Fi", "Gl", "Hy", "In", "Ju", "Kr", "Lo", "Mi", "No", "Ob",
  "Pr", "Ri", "Si", "Th", "Un", "Ve", "Wy", "Xe", "Yo", "Zi",
];

const NAME_SUFFIXES = [
  "thar", "rius", "gon", "nia", "pha", "dra", "tos", "lux",
  "nix", "vos", "rae", "tis", "lon", "mus", "pex", "kra",
  "zel", "bur", "dan", "fer", "hol", "jun", "kel", "mir",
  "nor", "pul", "rem", "sol", "tar", "ven", "wis", "xar",
  "yan", "zor", "ath", "bis", "cor", "div", "eon", "fyr",
];

const NAME_DESIGNATIONS = [
  "", "", "", "", "", "", "", "", "", "", // 10/20 → 50% no designation
  " Prime", " Major", " Minor",
  "-\u03b1", "-\u03b2", "-\u03b3", "-\u03b4",
  " I", " II", " III",
];

/* ═══════════════════════ Generator ═══════════════════════ */

export function generateStarMap(
  width: number,
  height: number,
  count: number,
  seed: number,
  minDist: number,
  shape?: {
    innerRadiusFraction: number;
    outerRadiusFraction: number;
    spiralArms: number;
    spiralTightness: number;
    armSpread: number;
  },
): StarData[] {
  const rng = mulberry32(seed);
  const minDistSq = minDist * minDist;

  // ── Grid-based spatial hash for fast overlap checks ──
  const cellSize = minDist;
  const grid = new Map<string, Array<{ x: number; z: number }>>();

  function gridKey(x: number, z: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  }

  function insertGrid(x: number, z: number): void {
    const key = gridKey(x, z);
    let cell = grid.get(key);
    if (!cell) {
      cell = [];
      grid.set(key, cell);
    }
    cell.push({ x, z });
  }

  function isTooClose(x: number, z: number): boolean {
    const gx = Math.floor(x / cellSize);
    const gz = Math.floor(z / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(`${gx + dx},${gz + dz}`);
        if (cell) {
          for (const s of cell) {
            const ddx = x - s.x;
            const ddz = z - s.z;
            if (ddx * ddx + ddz * ddz < minDistSq) return true;
          }
        }
      }
    }
    return false;
  }

  // ── Weighted type selection ──
  const typeEntries = Object.entries(STAR_TYPES) as [StarType, StarTypeConfig][];
  const totalWeight = typeEntries.reduce((s, [, c]) => s + c.weight, 0);

  function pickType(): StarType {
    let r = rng() * totalWeight;
    for (const [type, config] of typeEntries) {
      r -= config.weight;
      if (r <= 0) return type;
    }
    return StarType.M;
  }

  function generateName(): string {
    const p = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
    const s = NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)];
    const d = NAME_DESIGNATIONS[Math.floor(rng() * NAME_DESIGNATIONS.length)];
    return `${p}${s}${d}`;
  }

  function generatePlanets(): PlanetConfig[] {
    const numPlanets = 1 + Math.floor(rng() * 4); // 1–4 planets
    const types: Array<"rocky" | "gas" | "ice"> = ["rocky", "gas", "ice"];
    const planets: PlanetConfig[] = [];

    for (let i = 0; i < numPlanets; i++) {
      const ptype = types[Math.floor(rng() * types.length)];
      let diameter: number;
      let orbitSpeed: number;

      switch (ptype) {
        case "rocky":
          diameter = 0.8 + rng() * 1.2;
          orbitSpeed = 0.3 + rng() * 0.4;
          break;
        case "gas":
          diameter = 2.0 + rng() * 2.5;
          orbitSpeed = 0.1 + rng() * 0.2;
          break;
        case "ice":
          diameter = 0.6 + rng() * 1.0;
          orbitSpeed = 0.4 + rng() * 0.5;
          break;
      }

      planets.push({
        type: ptype,
        diameter,
        orbitRadius: 7 + i * 5 + rng() * 3,
        orbitSpeed,
      });
    }

    return planets;
  }

  // ── Galaxy shape: ring/spiral distribution ──
  // Use the smaller of width/height as the reference for radii
  const halfSize = Math.min(width, height) / 2;
  const innerR = shape ? halfSize * shape.innerRadiusFraction : 0;
  const outerR = shape ? halfSize * shape.outerRadiusFraction : halfSize * 0.95;
  const arms = shape?.spiralArms ?? 0;
  const tightness = shape?.spiralTightness ?? 0;
  const armSpread = shape?.armSpread ?? 1;

  /** Generate a candidate (x, z) in the ring/spiral shape */
  function samplePosition(): { x: number; z: number } {
    if (arms <= 0) {
      // Uniform ring: random angle, random radius between inner and outer
      const angle = rng() * Math.PI * 2;
      // Use sqrt for uniform area distribution
      const rFrac = Math.sqrt(rng());
      const r = innerR + rFrac * (outerR - innerR);
      // Stretch to ellipse: width/height ratio
      const xScale = width / Math.min(width, height);
      const zScale = height / Math.min(width, height);
      return { x: Math.cos(angle) * r * xScale, z: Math.sin(angle) * r * zScale };
    }

    // Spiral arm distribution
    // Pick a random arm
    const arm = Math.floor(rng() * arms);
    const armAngleOffset = (arm / arms) * Math.PI * 2;

    // Pick a radial distance (sqrt for uniform area)
    const rFrac = Math.sqrt(rng());
    const r = innerR + rFrac * (outerR - innerR);

    // Base angle follows spiral curve
    const normalizedR = (r - innerR) / (outerR - innerR); // 0–1
    const spiralAngle = armAngleOffset + normalizedR * tightness * Math.PI;

    // Scatter perpendicular to the arm
    // Scatter decreases toward center for denser core ring
    const scatter = (rng() - 0.5) * armSpread * (0.5 + 0.5 * normalizedR);
    const finalAngle = spiralAngle + scatter;

    const xScale = width / Math.min(width, height);
    const zScale = height / Math.min(width, height);
    return {
      x: Math.cos(finalAngle) * r * xScale,
      z: Math.sin(finalAngle) * r * zScale,
    };
  }

  // ── Generate all stars ──
  const stars: StarData[] = [];
  const maxAttempts = 200;

  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let placed = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pos = samplePosition();
      x = pos.x;
      z = pos.z;

      if (!isTooClose(x, z)) {
        placed = true;
        break;
      }
    }

    // If couldn't place with spacing, force-place anyway
    if (!placed) {
      const pos = samplePosition();
      x = pos.x;
      z = pos.z;
    }

    insertGrid(x, z);

    const type = pickType();
    const cfg = STAR_TYPES[type];
    const luminosity = cfg.luminosityMin + rng() * (cfg.luminosityMax - cfg.luminosityMin);

    // Slight per-star color variance for visual interest
    const v = 0.08;
    const color: [number, number, number] = [
      Math.min(1, Math.max(0, cfg.color[0] + (rng() - 0.5) * v)),
      Math.min(1, Math.max(0, cfg.color[1] + (rng() - 0.5) * v)),
      Math.min(1, Math.max(0, cfg.color[2] + (rng() - 0.5) * v)),
    ];

    stars.push({
      id: i,
      name: generateName(),
      type,
      x,
      z,
      luminosity,
      color,
      system: { planets: generatePlanets() },
    });
  }

  return stars;
}
