/**
 * GalaxyMap — Galaxy-level configuration.
 * Defines overall map dimensions, camera limits, and transition thresholds.
 * This is the top-level data layer: GalaxyMap → StarMap → (future: planets, objects)
 */

export interface GalaxyMapConfig {
  /** Full width of the galaxy plane (X axis, centered at 0) */
  width: number;
  /** Full height of the galaxy plane (Z axis, centered at 0) */
  height: number;

  /** Galaxy shape */
  shape: {
    /** Inner radius of the star ring (empty center) as fraction of galaxy half-size */
    innerRadiusFraction: number;
    /** Outer radius as fraction of galaxy half-size */
    outerRadiusFraction: number;
    /** Number of spiral arms (0 = uniform ring) */
    spiralArms: number;
    /** How tightly wound the spiral is (higher = more turns) */
    spiralTightness: number;
    /** How much stars scatter perpendicular to spiral arms */
    armSpread: number;
  };
  /** Number of stars to generate */
  starCount: number;
  /** Seed for deterministic procedural generation */
  seed: number;
  /** Minimum distance between any two stars */
  minStarSpacing: number;

  /** Camera configuration */
  camera: {
    minRadius: number;
    maxRadius: number;
    startRadius: number;
    startAlpha: number;
    startBeta: number;
    minBeta: number;
    maxBeta: number;
    /** Percentage of radius per scroll tick (exponential zoom) */
    wheelDeltaPercentage: number;
    inertia: number;
  };

  /** Zoom-based transition thresholds for star system view */
  transition: {
    /** Camera radius where system starts becoming visible */
    systemFadeStart: number;
    /** Camera radius where system is fully visible */
    systemFadeEnd: number;
    /** Max distance from camera target to star center to be "focused" */
    focusDistance: number;
    /** Max panning radius when fully zoomed into a system */
    systemBorderRadius: number;
    /** System scale at the moment it fully fades in (entry point) */
    systemScaleAtEntry: number;
    /** Camera radius at which system reaches full (1.0) scale */
    systemFullScaleRadius: number;

    /* ── Zoom-out hysteresis (asymmetric exit) ── */
    /** Camera radius where system starts fading on zoom-OUT (larger = harder to leave) */
    systemFadeStartOut: number;
    /** Camera radius where system is fully gone on zoom-OUT */
    systemFadeEndOut: number;
    /** Focus distance used when already inside a system (more lenient) */
    focusDistanceOut: number;

    /* ── Neighbor suppression ── */
    /** World-unit radius around the focus star for suppression */
    suppressionRadius: number;
    /** Blend threshold (0–1) at which suppression begins */
    suppressionStartBlend: number;
    /** Minimum alpha for fully suppressed neighbors */
    suppressionMinAlpha: number;
    /** Scale factor for fully suppressed neighbors (e.g. 0.3 = 30%) */
    suppressionShrinkFactor: number;

    /* ── Camera magnetization ── */
    /** Blend threshold at which camera starts centering on the star */
    magnetStartBlend: number;
    /** Strength of per-frame camera pull toward star (0–1) */
    magnetStrength: number;

    /* ── Target lock ── */
    /** Blend above which the focused star is locked (can't switch targets) */
    lockBlendThreshold: number;
  };
}

export const GALAXY_MAP: GalaxyMapConfig = {
  width: 1500,
  height: 1000,
  starCount: 500,
  seed: 42,
  minStarSpacing: 24,

  shape: {
    innerRadiusFraction: 0.25,
    outerRadiusFraction: 0.92,
    spiralArms: 4,
    spiralTightness: 2.5,
    armSpread: 0.35,
  },

  camera: {
    minRadius: 2,
    maxRadius: 900,
    startRadius: 900,
    startAlpha: -Math.PI / 2,
    startBeta: Math.PI / 4,
    minBeta: 0.1,
    maxBeta: Math.PI / 2.2,
    wheelDeltaPercentage: 0.08,
    inertia: 0.85,
  },

  transition: {
    systemFadeStart: 30,
    systemFadeEnd: 12,
    focusDistance: 18,
    systemBorderRadius: 20,
    systemScaleAtEntry: 0.15,
    systemFullScaleRadius: 3,

    // Zoom-out hysteresis (2.5x harder to leave system view)
    systemFadeStartOut: 75,
    systemFadeEndOut: 30,
    focusDistanceOut: 45,

    // Neighbor suppression
    suppressionRadius: 80,
    suppressionStartBlend: 0.05,
    suppressionMinAlpha: 0.04,
    suppressionShrinkFactor: 0.25,

    // Camera magnetization
    magnetStartBlend: 0.08,
    magnetStrength: 3.0,

    // Target lock
    lockBlendThreshold: 0.12,
  },
};
