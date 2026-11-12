import { describe, expect, it } from 'vitest';
import type { Aircraft } from './types';
import { destinationPoint } from './extrapolate';
import { conePolygon } from './direction';
import {
  bboxKey,
  filterFlightsForSelection,
  selectionBbox,
} from './selectionArea';
import type { DirectionalSelection } from './directionalView';

const origin = { latitude: 0, longitude: 0 };
const direction: DirectionalSelection = {
  origin,
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

function aircraft(
  icao24: string,
  point: { latitude: number; longitude: number },
): Aircraft {
  return {
    icao24,
    callsign: icao24.toUpperCase(),
    origin_country: 'Testland',
    lastContactMs: 1_000,
    lastPositionMs: 1_000,
    latitude: point.latitude,
    longitude: point.longitude,
    baro_altitude: 5_000,
    geo_altitude: null,
    on_ground: false,
    velocity: 200,
    true_track: 90,
    vertical_rate: 0,
    squawk: '7000',
    spi: false,
    providerId: 'opensky',
  };
}

function inside(box: NonNullable<ReturnType<typeof selectionBbox>>, point: {
  latitude: number;
  longitude: number;
}): boolean {
  return (
    point.latitude >= box.lamin &&
    point.latitude <= box.lamax &&
    point.longitude >= box.lomin &&
    point.longitude <= box.lomax
  );
}

describe('bboxKey', () => {
  it('builds a stable key and handles no area', () => {
    expect(bboxKey(null)).toBeNull();
    expect(
      bboxKey({ lamin: 50, lomin: -1, lamax: 51, lomax: 0 }),
    ).toBe('50:-1:51:0');
  });
});

describe('selectionBbox', () => {
  it('uses the perimeter directly in Perimeter mode', () => {
    const perimeter = { lamin: 50, lomin: -1, lamax: 51, lomax: 0 };
    expect(
      selectionBbox({ mode: 'perimeter', perimeter, direction }),
    ).toBe(perimeter);
  });

  it('returns no query area for an unfinished View', () => {
    expect(
      selectionBbox({ mode: 'direction', perimeter: null, direction: null }),
    ).toBeNull();
    expect(
      selectionBbox({
        mode: 'direction',
        perimeter: { lamin: 50, lomin: -1, lamax: 51, lomax: 0 },
        direction: null,
      }),
    ).toBeNull();
  });

  it('encloses the whole View cone', () => {
    const box = selectionBbox({
      mode: 'direction',
      perimeter: null,
      direction,
    });
    expect(box).not.toBeNull();

    for (const point of conePolygon(
      direction.origin,
      direction.bearingDeg,
      direction.angleDeg,
      direction.visibilityKm,
    )) {
      expect(inside(box!, point)).toBe(true);
    }
  });
});

describe('filterFlightsForSelection', () => {
  it('passes the snapshot through in Perimeter mode', () => {
    const flights = [aircraft('abc123', { latitude: 10, longitude: 10 })];
    expect(
      filterFlightsForSelection(flights, 'perimeter', direction),
    ).toBe(flights);
  });

  it('returns no flights when a View has no bearing yet', () => {
    const flights = [aircraft('abc123', origin)];
    expect(filterFlightsForSelection(flights, 'direction', null)).toEqual([]);
  });

  it('keeps only aircraft inside the cone', () => {
    const east = aircraft('east', destinationPoint(origin, 90, 50_000));
    const boundary = aircraft(
      'boundary',
      destinationPoint(origin, 120, 50_000),
    );
    const north = aircraft('north', destinationPoint(origin, 0, 50_000));
    const far = aircraft('far', destinationPoint(origin, 90, 150_000));
    const west = aircraft('west', destinationPoint(origin, 270, 50_000));

    const filtered = filterFlightsForSelection(
      [east, boundary, north, far, west],
      'direction',
      direction,
    );

    expect(filtered.map((flight) => flight.icao24)).toEqual([
      'east',
      'boundary',
    ]);
  });

  it('keeps on-ground aircraft that are inside the cone', () => {
    const ground = {
      ...aircraft('ground', destinationPoint(origin, 90, 20_000)),
      on_ground: true,
    };

    expect(
      filterFlightsForSelection([ground], 'direction', direction),
    ).toEqual([ground]);
  });
});
