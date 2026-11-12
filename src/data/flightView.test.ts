import { describe, expect, it } from 'vitest';
import type { Aircraft } from './types';
import {
  DEFAULT_FLIGHT_VIEW,
  filterAndSortFlights,
} from './flightView';

function aircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    icao24: 'abc123',
    callsign: 'ABC123',
    origin_country: 'Testland',
    lastContactMs: 1_000,
    lastPositionMs: 1_000,
    latitude: 51,
    longitude: 0,
    baro_altitude: 5_000,
    geo_altitude: null,
    on_ground: false,
    velocity: 200,
    true_track: 90,
    vertical_rate: 0,
    squawk: '7000',
    spi: false,
    providerId: 'opensky',
    ...overrides,
  };
}

const callsigns = (flights: Aircraft[]) =>
  flights.map((flight) => flight.callsign);

describe('filterAndSortFlights', () => {
  it('defaults to airborne, unsorted query, callsign order', () => {
    expect(DEFAULT_FLIGHT_VIEW).toEqual({
      query: '',
      sort: 'callsign',
      filter: 'airborne',
    });
  });

  it('filters airborne, on-ground, and all', () => {
    const airborne = aircraft({ icao24: 'a', callsign: 'AIR' });
    const ground = aircraft({
      icao24: 'b',
      callsign: 'GND',
      on_ground: true,
    });
    const flights = [airborne, ground];

    expect(
      filterAndSortFlights(flights, { ...DEFAULT_FLIGHT_VIEW }),
    ).toEqual([airborne]);
    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        filter: 'on-ground',
      }),
    ).toEqual([ground]);
    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        filter: 'all',
      }),
    ).toEqual([airborne, ground]);
  });

  it('searches callsign or ICAO case-insensitively, with trim', () => {
    const flights = [
      aircraft({ icao24: 'abc123', callsign: 'SWA123' }),
      aircraft({ icao24: 'def456', callsign: 'BAW456' }),
    ];

    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        query: ' swa ',
      }).map((flight) => flight.icao24),
    ).toEqual(['abc123']);
    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        query: 'DEF',
      }).map((flight) => flight.icao24),
    ).toEqual(['def456']);
  });

  it('returns no rows when nothing matches', () => {
    expect(
      filterAndSortFlights([aircraft()], {
        ...DEFAULT_FLIGHT_VIEW,
        query: 'zzz',
      }),
    ).toEqual([]);
  });

  it('sorts callsigns with missing callsigns last', () => {
    const flights = [
      aircraft({ icao24: 'c', callsign: 'CHARLIE' }),
      aircraft({ icao24: 'a', callsign: null }),
      aircraft({ icao24: 'b', callsign: 'alpha' }),
    ];

    expect(callsigns(filterAndSortFlights(flights))).toEqual([
      'alpha',
      'CHARLIE',
      null,
    ]);
  });

  it('sorts altitude, speed, vertical rate, and contact descending', () => {
    const flights = [
      aircraft({ icao24: 'a', baro_altitude: 1_000, velocity: 100, vertical_rate: 1, lastContactMs: 1 }),
      aircraft({ icao24: 'b', baro_altitude: 9_000, velocity: 300, vertical_rate: 5, lastContactMs: 3 }),
      aircraft({ icao24: 'c', baro_altitude: null, velocity: null, vertical_rate: null, lastContactMs: 2 }),
    ];

    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        sort: 'altitude-desc',
      }).map((flight) => flight.icao24),
    ).toEqual(['b', 'a', 'c']);
    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        sort: 'speed-desc',
      }).map((flight) => flight.icao24),
    ).toEqual(['b', 'a', 'c']);
    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        sort: 'vertical-desc',
      }).map((flight) => flight.icao24),
    ).toEqual(['b', 'a', 'c']);
    expect(
      filterAndSortFlights(flights, {
        ...DEFAULT_FLIGHT_VIEW,
        sort: 'contact-desc',
      }).map((flight) => flight.icao24),
    ).toEqual(['b', 'c', 'a']);
  });

  it('uses ICAO as a deterministic tie-breaker', () => {
    const flights = [
      aircraft({ icao24: 'b', callsign: 'SAME' }),
      aircraft({ icao24: 'a', callsign: 'SAME' }),
    ];

    expect(
      filterAndSortFlights(flights).map((flight) => flight.icao24),
    ).toEqual(['a', 'b']);
  });

  it('does not mutate the input order', () => {
    const flights = [
      aircraft({ icao24: 'b', callsign: 'B' }),
      aircraft({ icao24: 'a', callsign: 'A' }),
    ];
    const original = [...flights];

    filterAndSortFlights(flights);

    expect(flights).toEqual(original);
  });
});
