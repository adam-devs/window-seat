import type { BoundingBox } from '../types';

/** Shared validation for provider query boxes. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validate and normalize a bounding box.
 *
 * Corners may be supplied in either order; the result is always south-west to
 * north-east. Degenerate boxes (zero height or width) and out-of-range
 * coordinates are rejected.
 */
export function parseBoundingBox(value: unknown): BoundingBox | null {
  if (!isRecord(value)) return null;

  const lamin = finiteNumber(value.lamin);
  const lamax = finiteNumber(value.lamax);
  const lomin = finiteNumber(value.lomin);
  const lomax = finiteNumber(value.lomax);
  if (
    lamin === null ||
    lamax === null ||
    lomin === null ||
    lomax === null ||
    lamin < -90 ||
    lamax > 90 ||
    lomin < -180 ||
    lomax > 180
  ) {
    return null;
  }

  const south = Math.min(lamin, lamax);
  const north = Math.max(lamin, lamax);
  const west = Math.min(lomin, lomax);
  const east = Math.max(lomin, lomax);
  if (south === north || west === east) return null;

  return { lamin: south, lomin: west, lamax: north, lomax: east };
}
