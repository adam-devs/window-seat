/**
 * Raw OpenSky fixtures for adapter tests.
 *
 * Rows are `unknown[]` on purpose: the adapter must stay defensive even when a
 * field is missing, the wrong type, or out of range.
 */

export const BBOX = { lamin: 51.4, lomin: -0.2, lamax: 51.6, lomax: 0.1 };

/** Typical row, including the optional `category` at index 17. */
export const VALID_ROW: unknown[] = [
  'ABC123', // 0  icao24
  ' BAW123  ', // 1  callsign
  'United Kingdom', // 2  origin_country
  1_700_000_000, // 3  time_position (s)
  1_700_000_001, // 4  last_contact (s)
  -0.1276, // 5  longitude
  51.5072, // 6  latitude
  10_000, // 7  baro_altitude (m)
  false, // 8  on_ground
  250, // 9  velocity (m/s)
  90, // 10 true_track (deg)
  -1.5, // 11 vertical_rate (m/s)
  null, // 12 sensors
  10_200, // 13 geo_altitude (m)
  '7000', // 14 squawk
  false, // 15 spi
  0, // 16 position_source
  3, // 17 category (extended only)
];

/** On-ground aircraft with no motion data. */
export const SECOND_ROW: unknown[] = [
  'def456',
  null,
  'France',
  1_700_000_000,
  1_700_000_002,
  2.3522,
  48.8566,
  null,
  true,
  null,
  null,
  null,
  null,
  null,
  null,
  false,
  0,
];

/** Copy a valid row with one field replaced. */
export function rowWith(index: number, value: unknown): unknown[] {
  const row = [...VALID_ROW];
  row[index] = value;
  return row;
}

export const STATES_RESPONSE = {
  time: 1_700_000_002,
  states: [VALID_ROW, SECOND_ROW],
};

/** Mix of valid and unusable rows used to check defensive filtering. */
export const MIXED_STATES_RESPONSE = {
  time: 1_700_000_002,
  states: [
    VALID_ROW,
    SECOND_ROW,
    rowWith(5, null), // no longitude
    rowWith(6, null), // no latitude
    rowWith(6, 91), // latitude out of range
    rowWith(5, 181), // longitude out of range
    rowWith(0, '   '), // no identity
    rowWith(4, null), // no contact timestamp
    ['short-row'], // truncated
    null, // not a row at all
  ],
};

export const NULL_STATES_RESPONSE = { time: 1_700_000_002, states: null };

export const EMPTY_STATES_RESPONSE = { time: 1_700_000_002, states: [] };
