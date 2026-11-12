import { describe, expect, it } from 'vitest';
import { destinationPoint } from './extrapolate';
import {
  angularDifference,
  coneBoundingBox,
  conePolygon,
  distanceMeters,
  initialBearing,
  isPointInCone,
  normalizeBearing,
} from './direction';

function contains(box: ReturnType<typeof coneBoundingBox>, point: { latitude: number; longitude: number }): boolean {
  return (
    point.latitude >= box.lamin &&
    point.latitude <= box.lamax &&
    point.longitude >= box.lomin &&
    point.longitude <= box.lomax
  );
}

describe('bearing helpers', () => {
  it('normalizes bearings', () => {
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(370)).toBe(10);
    expect(normalizeBearing(720)).toBe(0);
  });

  it('returns cardinal initial bearings', () => {
    const origin = { latitude: 0, longitude: 0 };
    expect(initialBearing(origin, { latitude: 1, longitude: 0 })).toBeCloseTo(0, 6);
    expect(initialBearing(origin, { latitude: 0, longitude: 1 })).toBeCloseTo(90, 6);
    expect(initialBearing(origin, { latitude: -1, longitude: 0 })).toBeCloseTo(180, 6);
    expect(initialBearing(origin, { latitude: 0, longitude: -1 })).toBeCloseTo(270, 6);
  });

  it('handles antimeridian and the same point', () => {
    expect(
      initialBearing(
        { latitude: 0, longitude: 179 },
        { latitude: 0, longitude: -179 },
      ),
    ).toBeCloseTo(90, 6);
    expect(
      initialBearing(
        { latitude: 51, longitude: 0 },
        { latitude: 51, longitude: 0 },
      ),
    ).toBe(0);
  });

  it('computes shortest signed angular differences', () => {
    expect(angularDifference(350, 10)).toBe(20);
    expect(angularDifference(10, 350)).toBe(-20);
    expect(angularDifference(0, 180)).toBe(180);
    expect(angularDifference(180, 0)).toBe(180);
  });

  it('measures great-circle distance', () => {
    const oneDegree = distanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(oneDegree).toBeGreaterThan(111_000);
    expect(oneDegree).toBeLessThan(111_300);
    expect(
      distanceMeters(
        { latitude: 51, longitude: 0 },
        { latitude: 51, longitude: 0 },
      ),
    ).toBe(0);
  });
});

describe('isPointInCone', () => {
  const origin = { latitude: 0, longitude: 0 };
  const east50 = destinationPoint(origin, 90, 50_000);

  it('includes points within angle and distance', () => {
    expect(isPointInCone(east50, origin, 90, 60, 100)).toBe(true);
    expect(isPointInCone(origin, origin, 90, 60, 100)).toBe(true);
  });

  it('rejects points outside the angle or distance', () => {
    const west50 = destinationPoint(origin, 270, 50_000);
    const east150 = destinationPoint(origin, 90, 150_000);
    const northEast50 = destinationPoint(origin, 45, 50_000);

    expect(isPointInCone(west50, origin, 90, 60, 100)).toBe(false);
    expect(isPointInCone(east150, origin, 90, 60, 100)).toBe(false);
    expect(isPointInCone(northEast50, origin, 90, 60, 100)).toBe(false);
    expect(isPointInCone(northEast50, origin, 90, 120, 100)).toBe(true);
  });

  it('handles antimeridian and polar points', () => {
    const antimeridianOrigin = { latitude: 0, longitude: 179.9 };
    const across = destinationPoint(antimeridianOrigin, 90, 50_000);
    expect(
      isPointInCone(across, antimeridianOrigin, 90, 60, 100),
    ).toBe(true);

    const polarOrigin = { latitude: 89.9, longitude: 0 };
    const overPole = destinationPoint(polarOrigin, 0, 50_000);
    expect(isPointInCone(overPole, polarOrigin, 0, 60, 100)).toBe(true);
  });

  it('rejects invalid angle or distance', () => {
    expect(isPointInCone(east50, origin, 90, 0, 100)).toBe(false);
    expect(isPointInCone(east50, origin, 90, 60, 0)).toBe(false);
    expect(isPointInCone(east50, origin, 90, 60, Number.NaN)).toBe(false);
  });
});

describe('conePolygon', () => {
  it('starts at the origin and samples the arc', () => {
    const points = conePolygon({ latitude: 0, longitude: 0 }, 90, 60, 100, 12);

    expect(points).toHaveLength(14);
    expect(points[0]).toEqual({ latitude: 0, longitude: 0 });
    for (const point of points.slice(1)) {
      expect(
        distanceMeters({ latitude: 0, longitude: 0 }, point),
      ).toBeCloseTo(100_000, 0);
    }
  });
});

describe('coneBoundingBox', () => {
  it('encloses all sampled cone points', () => {
    const origin = { latitude: 51.5, longitude: -0.1 };
    const box = coneBoundingBox(origin, 45, 60, 100);
    const points = conePolygon(origin, 45, 60, 100);

    for (const point of points) {
      expect(contains(box, point)).toBe(true);
    }
    expect(box.lamax).toBeGreaterThan(box.lamin);
    expect(box.lomax).toBeGreaterThan(box.lomin);
  });

  it('falls back to world longitude coverage across the antimeridian', () => {
    const box = coneBoundingBox({ latitude: 0, longitude: 179.9 }, 90, 90, 100);

    expect(box.lomin).toBe(-180);
    expect(box.lomax).toBe(180);
    expect(box.lamin).toBeGreaterThanOrEqual(-90);
    expect(box.lamax).toBeLessThanOrEqual(90);
  });

  it('keeps polar boxes finite and within bounds', () => {
    const box = coneBoundingBox({ latitude: 89.9, longitude: 0 }, 180, 120, 200);

    expect(Number.isFinite(box.lamin)).toBe(true);
    expect(Number.isFinite(box.lamax)).toBe(true);
    expect(Number.isFinite(box.lomin)).toBe(true);
    expect(Number.isFinite(box.lomax)).toBe(true);
    expect(box.lamin).toBeGreaterThanOrEqual(-90);
    expect(box.lamax).toBeLessThanOrEqual(90);
    expect(box.lomin).toBeGreaterThanOrEqual(-180);
    expect(box.lomax).toBeLessThanOrEqual(180);
  });
});
