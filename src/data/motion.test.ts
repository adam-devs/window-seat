import { describe, expect, it } from 'vitest';
import type { Aircraft } from './types';
import {
  DEFAULT_CORRECTION_MS,
  createAircraftMotionTracker,
  easeOutCubic,
  interpolateGeo,
} from './motion';

function aircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    icao24: 'abc123',
    callsign: null,
    origin_country: null,
    lastContactMs: 0,
    lastPositionMs: 0,
    latitude: 0,
    longitude: 0,
    baro_altitude: null,
    geo_altitude: null,
    on_ground: false,
    velocity: 0,
    true_track: 0,
    vertical_rate: null,
    squawk: null,
    spi: false,
    providerId: 'opensky',
    ...overrides,
  };
}

describe('easeOutCubic', () => {
  it('clamps and eases from 0 to 1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('interpolateGeo', () => {
  it('interpolates latitude and longitude', () => {
    expect(
      interpolateGeo(
        { latitude: 0, longitude: 0 },
        { latitude: 10, longitude: 20 },
        0.5,
      ),
    ).toEqual({ latitude: 5, longitude: 10 });
  });

  it('takes the short path across the antimeridian', () => {
    expect(
      interpolateGeo(
        { latitude: 0, longitude: 179 },
        { latitude: 0, longitude: -179 },
        0.5,
      ),
    ).toEqual({ latitude: 0, longitude: 180 });
  });
});

describe('createAircraftMotionTracker', () => {
  it('projects a moving aircraft between snapshots', () => {
    const tracker = createAircraftMotionTracker();
    tracker.sync([aircraft({ velocity: 100, true_track: 0 })], 0);

    const later = tracker.positionAt('abc123', 10_000);

    expect(later).not.toBeNull();
    expect(later!.latitude).toBeGreaterThan(0);
    expect(later!.longitude).toBeCloseTo(0, 6);
  });

  it('eases from the display position to a fresh observation', () => {
    const tracker = createAircraftMotionTracker();
    tracker.sync([aircraft()], 0);
    expect(tracker.positionAt('abc123', 1_000)).toMatchObject({
      latitude: 0,
      longitude: 0,
    });

    tracker.sync([aircraft({ latitude: 1, lastPositionMs: 1_000 })], 1_000);

    // At the instant of the snapshot the display does not jump.
    expect(tracker.positionAt('abc123', 1_000)).toMatchObject({
      latitude: 0,
      longitude: 0,
    });
    expect(tracker.positionAt('abc123', 1_350)!.latitude).toBeCloseTo(
      0.875,
      6,
    );
    expect(tracker.positionAt('abc123', 1_000 + DEFAULT_CORRECTION_MS)).toMatchObject(
      { latitude: 1, longitude: 0 },
    );
  });

  it('honours a custom correction duration', () => {
    const tracker = createAircraftMotionTracker({ correctionMs: 0 });
    tracker.sync([aircraft()], 0);
    tracker.sync([aircraft({ latitude: 1 })], 1_000);

    expect(tracker.positionAt('abc123', 1_000)).toMatchObject({
      latitude: 1,
      longitude: 0,
    });
  });

  it('prunes aircraft that leave the snapshot', () => {
    const tracker = createAircraftMotionTracker();
    tracker.sync(
      [aircraft(), aircraft({ icao24: 'def456' })],
      0,
    );
    expect(tracker.size()).toBe(2);

    tracker.sync([aircraft()], 1_000);

    expect(tracker.size()).toBe(1);
    expect(tracker.has('abc123')).toBe(true);
    expect(tracker.has('def456')).toBe(false);
    expect(tracker.positionAt('def456', 1_000)).toBeNull();
  });

  it('returns null for unknown aircraft', () => {
    const tracker = createAircraftMotionTracker();
    expect(tracker.positionAt('missing', 0)).toBeNull();
  });

  it('applies new options without losing state', () => {
    const tracker = createAircraftMotionTracker({
      maxExtrapolationMs: 60_000,
    });
    tracker.sync([aircraft({ velocity: 100 })], 0);

    tracker.setOptions({ maxExtrapolationMs: 10_000 });

    expect(tracker.size()).toBe(1);
    expect(tracker.positionAt('abc123', 60_000)!.latitude).toBeCloseTo(
      0.00899,
      4,
    );
  });

  it('resets all state', () => {
    const tracker = createAircraftMotionTracker();
    tracker.sync([aircraft()], 0);

    tracker.reset();

    expect(tracker.size()).toBe(0);
    expect(tracker.positionAt('abc123', 0)).toBeNull();
  });
});
