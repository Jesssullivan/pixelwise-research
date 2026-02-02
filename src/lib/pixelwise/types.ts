export interface ConvexBlob {
  // Position & Velocity
  baseX: number;
  baseY: number;
  currentX: number;
  currentY: number;
  velocityX: number;
  velocityY: number;

  // Physical Properties
  size: number;
  elasticity: number;
  viscosity: number;
  phase: number;
  speed: number;
  color: string;
  gradientId: string;
  intensity: number;
  stickiness: number;
  isAttractive: boolean;
  mouseDistance: number;
  isStuck: boolean;
  fluidMass: number;
  scrollAffinity: number;
  radiusVariations: number[];

  // Optional Fluid Properties
  surfaceTension?: number;
  density?: number;
  flowResistance?: number;

  // Dynamic Shape Properties
  controlPoints?: Array<{
    radius: number;
    angle: number;
    targetRadius: number;
    baseRadius: number;
    pressure?: number;
    adhesion?: number;
    tension?: number;
  }>;
  controlVelocities?: Array<{
    radialVelocity: number;
    angularVelocity: number;
    pressureVelocity?: number;
  }>;
  deformationStrength?: number;
  cohesion?: number;
  stretchability?: number;
  lastCollisionTime?: number;
  mergeThreshold?: number;
  splitThreshold?: number;

  // Fluid/Settling Behavior
  isSettled?: boolean;
  settleTime?: number;
  groundContactPoints?: number[];
  restHeight?: number;

  // Water-on-Glass Properties
  wetting?: number;
  contactAngle?: number;
  pressureDistribution?: number[];
  chaosLevel?: number;
  turbulenceDecay?: number;

  // Stability Properties
  dampingFactor?: number;
  stabilityThreshold?: number;
  lastStableTime?: number;

  // 90s Screensaver Properties
  expansionPhase?: boolean;
  expansionTime?: number;
  maxExpansionTime?: number;
  wallBounceCount?: number;
  lastBounceTime?: number;
  driftAngle?: number;
  driftSpeed?: number;

  // Territory & Dispersion
  territoryRadius?: number;
  territoryX?: number;
  territoryY?: number;
  personalSpace?: number;
  repulsionStrength?: number;
  lastRepulsionTime?: number;
}

// Worker Message Types for type-safe worker communication

export type WorkerRequest =
  | { type: 'init'; payload: { wasmUrl: string } }
  | { type: 'adjust_colors'; payload: AdjustColorsPayload }
  | { type: 'adjust_character_colors'; payload: AdjustCharacterColorsPayload }
  | { type: 'detect_violations'; payload: DetectViolationsPayload }
  | { type: 'batch_sample'; payload: BatchSamplePayload }
  | { type: 'terminate' };

export interface AdjustColorsPayload {
  pixels: Uint8Array;
  targetContrast: number;
  width: number;
  height: number;
}

export interface AdjustCharacterColorsPayload {
  characterData: CharacterColorData[];
  backgroundColors: Uint8Array;
  targetContrast: number;
}

export interface CharacterColorData {
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: [number, number, number]; // RGB
}

export interface DetectViolationsPayload {
  blobs: BlobData[];
  aaThreshold: number;
}

export interface BlobData {
  x: number;
  y: number;
  radius: number;
  foregroundColor: [number, number, number];
  backgroundColor: [number, number, number];
}

export interface BatchSamplePayload {
  positions: Array<{ x: number; y: number }>;
  imageData: Uint8Array;
  width: number;
  height: number;
}

export type WorkerResponse<T = unknown> =
  | { success: true; data: T; metrics: { processingTime: number } }
  | { success: false; error: string };

// Result monad for consistent error handling
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
