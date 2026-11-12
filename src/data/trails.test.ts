import { describe, expect, it } from 'vitest';
import type { Aircraft } from './types';
import {
  DEFAULT_TRAIL_AGE_MS,
  DEFAULT_TRAIL_MAX_POINTS,
  createAircraftTrailStore,
} from './trails';

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
    velocity: 100,
    true_track: 90,
    vertical_rate: null,
    squawk: null,
    spi: false,
    providerId: 'opensky',
    ...overrides,
  };
}

describe('createAircraftTrailStore', () => {
  it('defaults to 120 s and a bounded point count', () => {
    expect(DEFAULT_TRAIL_AGE_MS).toBe(120_000);
    expect(DEFAULT_TRAIL_MAX_POINTS).toBe(60);
  });

  it('records one point per new fix and deduplicates repeats', () => {
    const store = createAircraftTrailStore();
    const first = aircraft({ latitude: 1, lastPositionMs: 1_000 });

    store.record([first], 1_000);
    store.record([first], 2_000);

    expect(store.getTrail('abc123')).toEqual([
      { latitude: 1, longitude: 0, observedAtMs: 1_000 },
    ]);
  });

  it('appends a newer fix', () => {
    const store = createAircraftTrailStore();
    store.record([aircraft({ lastPositionMs: 1_000 })], 1_000);
    store.record(
      [aircraft({ latitude: 2, lastPositionMs: 2_000 })],
      2_000,
    );

    expect(store.getTrail('abc123')).toHaveLength(2);
    expect(store.lastObserved('abc123')).toEqual({
      latitude: 2,
      longitude: 0,
      observedAtMs: 2_000,
    });
  });

  it('records a changed position even when the timestamp is unchanged', () => {
    const store = createAircraftTrailStore();
    store.record([aircraft({ lastPositionMs: 1_000 })], 1_000);
    store.record(
      [aircraft({ latitude: 1, lastPositionMs: 1_000 })],
      1_000,
    );

    expect(store.getTrail('abc123')).toHaveLength(2);
  });

  it('falls back to last contact when position time is missing', () => {
    const store = createAircraftTrailStore();
    store.record(
      [aircraft({ lastPositionMs: null, lastContactMs: 5_000 })],
      5_000,
    );

    expect(store.lastObserved('abc123')?.observedAtMs).toBe(5_000);
  });

  it('prunes points older than the age window', () => {
    const store = createAircraftTrailStore({ maxAgeMs: 1_000 });
    store.record([aircraft({ lastPositionMs: 0 })], 0);
    store.record(
      [aircraft({ latitude: 2, lastPositionMs: 5_000 })],
      5_000,
    );

    expect(store.getTrail('abc123')).toEqual([
      { latitude: 2, longitude: 0, observedAtMs: 5_000 },
    ]);
  });

  it('caps the number of points', () => {
    const store = createAircraftTrailStore({
      maxPoints: 3,
      maxAgeMs: 60_000,
    });

    for (let index = 0; index < 5; index += 1) {
      store.record(
        [
          aircraft({
            latitude: index,
            lastPositionMs: index * 1_000,
          }),
        ],
        index * 1_000,
      );
    }

    const trail = store.getTrail('abc123');
    expect(trail).toHaveLength(3);
    expect(trail[0].observedAtMs).toBe(2_000);
    expect(trail[2].observedAtMs).toBe(4_000);
  });

  it('drops aircraft that leave the snapshot', () => {
    const store = createAircraftTrailStore();
    store.record(
      [aircraft(), aircraft({ icao24: 'def456' })],
      0,
    );
    expect(store.size()).toBe(2);

    store.record([aircraft()], 1_000);

    expect(store.size()).toBe(1);
    expect(store.getTrail('def456')).toEqual([]);
  });

  it('returns copies and handles unknown aircraft', () => {
    const store = createAircraftTrailStore();
    store.record([aircraft()], 0);

    const trail = store.getTrail('abc123');
    trail[0].latitude = 99;

    expect(store.getTrail('abc123')[0].latitude).toBe(0);
    expect(store.getTrail('missing')).toEqual([]);
    expect(store.lastObserved('missing')).toBeNull();
  });

  it('resets all trails', () => {
    const store = createAircraftTrailStore();
    store.record([aircraft()], 0);

    store.reset();

    expect(store.size()).toBe(0);
    expect(store.getTrail('abc123')).toEqual([]);
  });
});
