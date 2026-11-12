import { describe, expect, it } from 'vitest';
import type { Aircraft } from './types';
import {
  MAX_EXTRAPOLATION_MS,
  canExtrapolate,
  destinationPoint,
  projectAircraftPosition,
  resolveExtrapolationCap,
} from './extrapolate';

function aircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    icao24: 'abc123',
    callsign: null,
    origin_country: null,
    lastContactMs: 0,
    lastPositionMs: 0,
    latitude: 51,
    longitude: 0,
    baro_altitude: null,
    geo_altitude: null,
    on_ground: false,
    velocity: 100,
    true_track: 90,
    vertical_rate: null,
    squawk: null,
    spi: false,
    providerId: 'opensky',
    ...overrides,
  };
}

describe('resolveExtrapolationCap', () => {
  it('defaults to the 30 s hard cap', () => {
    expect(resolveExtrapolationCap()).toBe(MAX_EXTRAPOLATION_MS);
    expect(resolveExtrapolationCap({ maxExtrapolationMs: 60_000 })).toBe(
      60_000,
    );
    expect(
      resolveExtrapolationCap({ maxExtrapolationMs: Number.NaN }),
    ).toBe(MAX_EXTRAPOLATION_MS);
    expect(resolveExtrapolationCap({ maxExtrapolationMs: -1 })).toBe(
      MAX_EXTRAPOLATION_MS,
    );
  });

  it('uses the smaller of the hard cap and two refresh intervals', () => {
    expect(
      resolveExtrapolationCap({
        maxExtrapolationMs: 60_000,
        refreshIntervalMs: 15_000,
      }),
    ).toBe(30_000);
    expect(
      resolveExtrapolationCap({
        maxExtrapolationMs: 20_000,
        refreshIntervalMs: 60_000,
      }),
    ).toBe(20_000);
    expect(
      resolveExtrapolationCap({ refreshIntervalMs: Number.NaN }),
    ).toBe(MAX_EXTRAPOLATION_MS);
    expect(resolveExtrapolationCap({ refreshIntervalMs: 0 })).toBe(
      MAX_EXTRAPOLATION_MS,
    );
  });
});

describe('canExtrapolate', () => {
  it('requires airborne, positive speed, and a finite track', () => {
    expect(canExtrapolate(aircraft())).toBe(true);
    expect(canExtrapolate(aircraft({ on_ground: true }))).toBe(false);
    expect(canExtrapolate(aircraft({ velocity: null }))).toBe(false);
    expect(canExtrapolate(aircraft({ velocity: 0 }))).toBe(false);
    expect(canExtrapolate(aircraft({ velocity: Number.NaN }))).toBe(false);
    expect(canExtrapolate(aircraft({ true_track: null }))).toBe(false);
    expect(canExtrapolate(aircraft({ true_track: Number.NaN }))).toBe(false);
  });
});

describe('destinationPoint', () => {
  it('moves one degree north/east at the equator', () => {
    const degree = 111_194.9;
    const north = destinationPoint({ latitude: 0, longitude: 0 }, 0, degree);
    const east = destinationPoint({ latitude: 0, longitude: 0 }, 90, degree);

    expect(north.latitude).toBeCloseTo(1, 5);
    expect(north.longitude).toBeCloseTo(0, 5);
    expect(east.latitude).toBeCloseTo(0, 5);
    expect(east.longitude).toBeCloseTo(1, 5);
  });

  it('wraps across the antimeridian', () => {
    const point = destinationPoint({ latitude: 0, longitude: 179 }, 90, 222_390);

    expect(point.longitude).toBeLessThan(0);
    expect(point.longitude).toBeGreaterThanOrEqual(-180);
  });

  it('returns the same point for zero distance', () => {
    expect(destinationPoint({ latitude: 51, longitude: 0 }, 90, 0)).toEqual({
      latitude: 51,
      longitude: 0,
    });
  });
});

describe('projectAircraftPosition', () => {
  it('projects east using speed and elapsed time', () => {
    const projected = projectAircraftPosition(aircraft(), 10_000);

    expect(projected.estimated).toBe(true);
    expect(projected.capped).toBe(false);
    expect(projected.ageMs).toBe(10_000);
    expect(projected.extrapolatedMs).toBe(10_000);
    expect(projected.distanceM).toBe(1_000);
    expect(projected.latitude).toBeCloseTo(51, 3);
    expect(projected.longitude).toBeGreaterThan(0);
    expect(projected.longitude).toBeCloseTo(0.0143, 3);
  });

  it('follows north, south, and west tracks', () => {
    const north = projectAircraftPosition(
      aircraft({ true_track: 0 }),
      10_000,
    );
    const south = projectAircraftPosition(
      aircraft({ true_track: 180 }),
      10_000,
    );
    const west = projectAircraftPosition(
      aircraft({ true_track: 270 }),
      10_000,
    );

    expect(north.latitude).toBeGreaterThan(51);
    expect(south.latitude).toBeLessThan(51);
    expect(west.longitude).toBeLessThan(0);
  });

  it('caps long gaps and reports the cap', () => {
    const projected = projectAircraftPosition(aircraft(), 120_000);

    expect(projected.ageMs).toBe(120_000);
    expect(projected.extrapolatedMs).toBe(MAX_EXTRAPOLATION_MS);
    expect(projected.distanceM).toBe(3_000);
    expect(projected.capped).toBe(true);
  });

  it('accepts a cadence-aware cap', () => {
    const projected = projectAircraftPosition(aircraft(), 120_000, {
      maxExtrapolationMs: 60_000,
      refreshIntervalMs: 10_000,
    });

    expect(projected.extrapolatedMs).toBe(20_000);
    expect(projected.distanceM).toBe(2_000);
  });

  it('prefers the position timestamp over last contact', () => {
    const projected = projectAircraftPosition(
      aircraft({ lastContactMs: 0, lastPositionMs: 20_000 }),
      30_000,
    );

    expect(projected.ageMs).toBe(10_000);
    expect(projected.distanceM).toBe(1_000);
  });

  it('falls back to last contact when position time is missing', () => {
    const projected = projectAircraftPosition(
      aircraft({ lastContactMs: 5_000, lastPositionMs: null }),
      15_000,
    );

    expect(projected.ageMs).toBe(10_000);
  });

  it('holds position for missing or unusable motion', () => {
    for (const overrides of [
      { on_ground: true },
      { velocity: null },
      { velocity: 0 },
      { velocity: Number.NaN },
      { true_track: null },
      { true_track: Number.NaN },
    ] as Array<Partial<Aircraft>>) {
      const projected = projectAircraftPosition(
        aircraft(overrides),
        10_000,
      );
      expect(projected).toMatchObject({
        latitude: 51,
        longitude: 0,
        distanceM: 0,
        extrapolatedMs: 0,
        estimated: false,
      });
    }
  });

  it('does not extrapolate backwards in time', () => {
    const projected = projectAircraftPosition(aircraft(), -5_000);

    expect(projected.ageMs).toBe(0);
    expect(projected.extrapolatedMs).toBe(0);
    expect(projected.estimated).toBe(false);
  });

  it('keeps antimeridian and polar projections finite', () => {
    const antimeridian = projectAircraftPosition(
      aircraft({ longitude: 179.99 }),
      20_000,
    );
    const polar = projectAircraftPosition(
      aircraft({ latitude: 89.999 }),
      30_000,
    );

    expect(antimeridian.longitude).toBeGreaterThanOrEqual(-180);
    expect(antimeridian.longitude).toBeLessThan(0);
    expect(Number.isFinite(polar.latitude)).toBe(true);
    expect(Number.isFinite(polar.longitude)).toBe(true);
    expect(polar.latitude).toBeLessThanOrEqual(90);
    expect(polar.latitude).toBeGreaterThanOrEqual(-90);
    expect(polar.longitude).toBeGreaterThanOrEqual(-180);
    expect(polar.longitude).toBeLessThanOrEqual(180);
  });
});
