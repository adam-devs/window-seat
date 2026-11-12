import type { SelectionMode } from '../types';
import { initialBearing, normalizeBearing } from './direction';

/**
 * Directional “View” selection.
 *
 * M3.5 starts with a fixed 60° full cone and a 100 km visibility distance. The
 * model is deliberately independent of Leaflet so the workspace can validate
 * it and the interaction layer can create it from map clicks.
 */

export const DEFAULT_CONE_ANGLE_DEG = 60;
export const DEFAULT_VISIBILITY_KM = 100;
export const MIN_CONE_ANGLE_DEG = 1;
export const MAX_CONE_ANGLE_DEG = 180;
export const MIN_VISIBILITY_KM = 1;
export const MAX_VISIBILITY_KM = 500;

export const SELECTION_MODE_LABELS: Record<SelectionMode, string> = {
  perimeter: 'Perimeter',
  direction: 'View',
};

export interface DirectionalOrigin {
  latitude: number;
  longitude: number;
}

export interface DirectionalSelection {
  origin: DirectionalOrigin;
  /** Bearing in degrees clockwise from north, normalized to [0, 360). */
  bearingDeg: number;
  /** Full cone angle in degrees. */
  angleDeg: number;
  /** Visibility distance in kilometres. */
  visibilityKm: number;
}

export const DIRECTIONAL_DEFAULTS = {
  angleDeg: DEFAULT_CONE_ANGLE_DEG,
  visibilityKm: DEFAULT_VISIBILITY_KM,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = finiteNumber(value);
  if (parsed === null) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseOrigin(value: unknown): DirectionalOrigin | null {
  if (!isRecord(value)) return null;
  const latitude = finiteNumber(value.latitude);
  const longitude = finiteNumber(value.longitude);
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

/** Validate and clamp an unknown persisted directional selection. */
export function normalizeDirectionalSelection(
  value: unknown,
): DirectionalSelection | null {
  if (!isRecord(value)) return null;
  const origin = parseOrigin(value.origin);
  if (!origin) return null;

  const bearing = finiteNumber(value.bearingDeg);
  if (bearing === null) return null;

  return {
    origin,
    bearingDeg: normalizeBearing(bearing),
    angleDeg: clamp(
      value.angleDeg,
      MIN_CONE_ANGLE_DEG,
      MAX_CONE_ANGLE_DEG,
      DEFAULT_CONE_ANGLE_DEG,
    ),
    visibilityKm: clamp(
      value.visibilityKm,
      MIN_VISIBILITY_KM,
      MAX_VISIBILITY_KM,
      DEFAULT_VISIBILITY_KM,
    ),
  };
}

/** Build a selection from known values, or null when the origin/bearing is invalid. */
export function createDirectionalSelection(
  origin: DirectionalOrigin,
  bearingDeg: number,
  options: Partial<Pick<DirectionalSelection, 'angleDeg' | 'visibilityKm'>> = {},
): DirectionalSelection | null {
  return normalizeDirectionalSelection({
    origin,
    bearingDeg,
    angleDeg: options.angleDeg ?? DEFAULT_CONE_ANGLE_DEG,
    visibilityKm: options.visibilityKm ?? DEFAULT_VISIBILITY_KM,
  });
}

/** Apply a partial update while preserving valid defaults/clamps. */
export function updateDirectionalSelection(
  current: DirectionalSelection,
  patch: Partial<DirectionalSelection>,
): DirectionalSelection {
  return (
    normalizeDirectionalSelection({ ...current, ...patch }) ?? current
  );
}

/**
 * Create a selection from the first click (origin) and second click (a point
 * along the desired bearing). Returns null when the points coincide.
 */
export function selectionFromPoints(
  origin: DirectionalOrigin,
  bearingPoint: DirectionalOrigin,
  options: Partial<Pick<DirectionalSelection, 'angleDeg' | 'visibilityKm'>> = {},
): DirectionalSelection | null {
  if (
    origin.latitude === bearingPoint.latitude &&
    origin.longitude === bearingPoint.longitude
  ) {
    return null;
  }
  return createDirectionalSelection(
    origin,
    initialBearing(origin, bearingPoint),
    options,
  );
}
