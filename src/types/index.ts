// OpenSky API returns state vectors as arrays
// https://openskynetwork.github.io/opensky-api/rest.html
export interface StateVector {
  icao24: string;        // Unique ICAO 24-bit address
  callsign: string | null;
  origin_country: string;
  time_position: number | null;
  last_contact: number;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null; // meters
  on_ground: boolean;
  velocity: number | null;      // m/s
  true_track: number | null;    // degrees clockwise from north
  vertical_rate: number | null; // m/s
  sensors: number[] | null;
  geo_altitude: number | null;  // meters
  squawk: string | null;
  spi: boolean;
  position_source: number;
}

export interface OpenSkyResponse {
  time: number;
  states: RawStateVector[] | null;
}

// Raw array from API before mapping
export type RawStateVector = [
  string,         // 0: icao24
  string | null,  // 1: callsign
  string,         // 2: origin_country
  number | null,  // 3: time_position
  number,         // 4: last_contact
  number | null,  // 5: longitude
  number | null,  // 6: latitude
  number | null,  // 7: baro_altitude
  boolean,        // 8: on_ground
  number | null,  // 9: velocity
  number | null,  // 10: true_track
  number | null,  // 11: vertical_rate
  number[] | null,// 12: sensors
  number | null,  // 13: geo_altitude
  string | null,  // 14: squawk
  boolean,        // 15: spi
  number,         // 16: position_source
];

export interface BoundingBox {
  lamin: number; // min latitude
  lomin: number; // min longitude
  lamax: number; // max latitude
  lomax: number; // max longitude
}

export type SelectionMode = 'perimeter';
