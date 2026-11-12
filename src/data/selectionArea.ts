import type { BoundingBox, SelectionMode } from '../types';
import type { Aircraft } from './types';
import { coneBoundingBox, isPointInCone } from './direction';
import type { DirectionalSelection } from './directionalView';

/**
 * Active selection geometry.
 *
 * Perimeter mode queries the drawn rectangle directly. View mode has no
 * rectangle of its own, so the provider is asked for the smallest bounding box
 * that encloses the cone and the result is filtered client-side by range and
 * bearing.
 */
export interface SelectionArea {
  mode: SelectionMode;
  perimeter: BoundingBox | null;
  direction: DirectionalSelection | null;
}

/** Stable key for a bounding box, or null when there is no area. */
export function bboxKey(bbox: BoundingBox | null): string | null {
  return bbox
    ? `${bbox.lamin}:${bbox.lomin}:${bbox.lamax}:${bbox.lomax}`
    : null;
}

/** Provider query area for the active selection, or null when there is none. */
export function selectionBbox({
  mode,
  perimeter,
  direction,
}: SelectionArea): BoundingBox | null {
  if (mode !== 'direction') return perimeter;
  if (!direction) return null;

  return coneBoundingBox(
    direction.origin,
    direction.bearingDeg,
    direction.angleDeg,
    direction.visibilityKm,
  );
}

/**
 * Keep only aircraft inside the active View cone. Perimeter mode passes the
 * snapshot through unchanged so ordering and identity stay stable for the map
 * and list engines.
 */
export function filterFlightsForSelection(
  flights: Aircraft[],
  mode: SelectionMode,
  direction: DirectionalSelection | null,
): Aircraft[] {
  if (mode !== 'direction') return flights;
  if (!direction) return [];

  return flights.filter((flight) =>
    isPointInCone(
      { latitude: flight.latitude, longitude: flight.longitude },
      direction.origin,
      direction.bearingDeg,
      direction.angleDeg,
      direction.visibilityKm,
    ),
  );
}
