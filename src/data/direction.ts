import type { BoundingBox } from '../types';
import { destinationPoint, type GeoPoint } from './extrapolate';

/**
 * Directional-view geometry.
 *
 * The user's cone is defined by an origin, a bearing, a full cone angle, and a
 * visibility distance. Everything here is pure spherical geometry so the view
 * can be tested without Leaflet or React.
 */

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Signed shortest rotation from `a` to `b`, in (-180, 180]. */
export function angularDifference(a: number, b: number): number {
  let difference = normalizeBearing(b) - normalizeBearing(a);
  if (difference > 180) difference -= 360;
  if (difference <= -180) difference += 360;
  return difference;
}

/** Initial great-circle bearing from one point to another. */
export function initialBearing(from: GeoPoint, to: GeoPoint): number {
  if (from.latitude === to.latitude && from.longitude === to.longitude) {
    return 0;
  }

  const lat1 = from.latitude * DEG;
  const lat2 = to.latitude * DEG;
  const deltaLon = (to.longitude - from.longitude) * DEG;

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return normalizeBearing((Math.atan2(y, x) / DEG));
}

/** Great-circle distance in metres. */
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const lat1 = from.latitude * DEG;
  const lat2 = to.latitude * DEG;
  const deltaLat = (to.latitude - from.latitude) * DEG;
  const deltaLon = (to.longitude - from.longitude) * DEG;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** True when a point lies within the cone and visibility distance. */
export function isPointInCone(
  point: GeoPoint,
  origin: GeoPoint,
  bearingDeg: number,
  angleDeg: number,
  visibilityKm: number,
): boolean {
  if (!Number.isFinite(visibilityKm) || visibilityKm <= 0) return false;
  if (!Number.isFinite(angleDeg) || angleDeg <= 0) return false;

  const distance = distanceMeters(origin, point);
  if (!Number.isFinite(distance) || distance > visibilityKm * 1_000) {
    return false;
  }
  if (distance === 0) return true;

  const pointBearing = initialBearing(origin, point);
  return (
    Math.abs(angularDifference(bearingDeg, pointBearing)) <=
    angleDeg / 2 + 1e-9
  );
}

/**
 * Polygon for the cone: origin followed by arc samples from the left edge to
 * the right edge. Leaflet closes the ring automatically.
 */
export function conePolygon(
  origin: GeoPoint,
  bearingDeg: number,
  angleDeg: number,
  visibilityKm: number,
  segments = 24,
): GeoPoint[] {
  const count = Math.max(2, Math.floor(segments));
  const halfAngle = Math.max(0, angleDeg) / 2;
  const radius = Math.max(0, visibilityKm) * 1_000;
  const start = bearingDeg - halfAngle;
  const points: GeoPoint[] = [{ ...origin }];

  for (let index = 0; index <= count; index += 1) {
    const bearing = start + (angleDeg * index) / count;
    points.push(destinationPoint(origin, bearing, radius));
  }

  return points;
}

function longitudeSpan(points: GeoPoint[]): { west: number; east: number } {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const longitude = ((point.longitude + 180) % 360 + 360) % 360 - 180;
    minimum = Math.min(minimum, longitude);
    maximum = Math.max(maximum, longitude);
  }

  // A bounding box cannot wrap the antimeridian; fall back to world coverage.
  return maximum - minimum > 180
    ? { west: -180, east: 180 }
    : { west: minimum, east: maximum };
}

/**
 * Smallest sampled bounding box that encloses the cone. Edges and the arc are
 * sampled so the provider bbox contains the whole visible sector.
 */
export function coneBoundingBox(
  origin: GeoPoint,
  bearingDeg: number,
  angleDeg: number,
  visibilityKm: number,
): BoundingBox {
  const halfAngle = Math.max(0, angleDeg) / 2;
  const radius = Math.max(0, visibilityKm) * 1_000;
  const samples = conePolygon(origin, bearingDeg, angleDeg, visibilityKm, 24);

  // Sample radial edges too: at long distances the great-circle arc alone does
  // not guarantee the latitude/longitude extremes.
  for (const edgeBearing of [bearingDeg - halfAngle, bearingDeg + halfAngle]) {
    for (let step = 1; step < 8; step += 1) {
      samples.push(
        destinationPoint(origin, edgeBearing, (radius * step) / 8),
      );
    }
  }

  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of samples) {
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }

  const { west, east } = longitudeSpan(samples);
  return {
    lamin: Math.max(-90, south),
    lamax: Math.min(90, north),
    lomin: west,
    lomax: east,
  };
}
