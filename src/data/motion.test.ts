import { describe, expect, it } from 'vitest';
import type { Aircraft } from './types';
import {
  DEFAULT_CORRECTION_MS,
  createAircraftMotionTracker,
  easeOutCubic,
  interpolateGeo,
  interpolateHeading,
  normalizeHeading,
  shortestHeadingDelta,
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

describe('heading interpolation', () => {
  it('normalizes headings and takes the shortest rotation', () => {
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(370)).toBe(10);
    expect(shortestHeadingDelta(350, 10)).toBe(20);
    expect(shortestHeadingDelta(10, 350)).toBe(-20);
    expect(shortestHeadingDelta(90, 180)).toBe(90);
  });

  it('interpolates across north without spinning the long way', () => {
    expect(interpolateHeading(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(interpolateHeading(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(interpolateHeading(90, 180, 0.5)).toBeCloseTo(135, 6);
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
    expect(tracker.headingAt('missing', 0)).toBeNull();
  });

  it('eases heading toward a fresh track and holds unknown headings', () => {
    const tracker = createAircraftMotionTracker();
    tracker.sync([aircraft({ true_track: 350 })], 0);
    expect(tracker.headingAt('abc123', 0)).toBe(350);

    tracker.sync([aircraft({ true_track: 10 })], 1_000);
    expect(tracker.headingAt('abc123', 1_000)).toBe(350);
    expect(tracker.headingAt('abc123', 1_350)).toBeCloseTo(7.5, 6);
    expect(tracker.headingAt('abc123', 1_000 + DEFAULT_CORRECTION_MS)).toBe(
      10,
    );

    tracker.sync([aircraft({ true_track: null })], 2_000);
    expect(tracker.headingAt('abc123', 2_000)).toBe(10);
    expect(tracker.headingAt('abc123', 5_000)).toBe(10);
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
