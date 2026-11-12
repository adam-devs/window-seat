import type { BoundingBox, OpenSkyResponse, RawStateVector, StateVector } from '../types';

export function parseStateVector(raw: RawStateVector): StateVector {
  return {
    icao24: raw[0],
    callsign: raw[1]?.trim() || null,
    origin_country: raw[2],
    time_position: raw[3],
    last_contact: raw[4],
    longitude: raw[5],
    latitude: raw[6],
    baro_altitude: raw[7],
    on_ground: raw[8],
    velocity: raw[9],
    true_track: raw[10],
    vertical_rate: raw[11],
    sensors: raw[12],
    geo_altitude: raw[13],
    squawk: raw[14],
    spi: raw[15],
    position_source: raw[16],
  };
}

export async function fetchFlights(
  bbox: BoundingBox,
  signal?: AbortSignal,
): Promise<StateVector[]> {
  const params = new URLSearchParams({
    lamin: bbox.lamin.toString(),
    lomin: bbox.lomin.toString(),
    lamax: bbox.lamax.toString(),
    lomax: bbox.lomax.toString(),
  });

  // Uses the Vite dev proxy to avoid CORS issues in dev.
  // The proxy also injects OpenSky OAuth credentials from `.env.local` when set.
  const res = await fetch(`/opensky/api/states/all?${params.toString()}`, { signal });

  if (!res.ok) {
    throw new Error(`OpenSky API error: ${res.status} ${res.statusText}`);
  }

  const data: OpenSkyResponse = await res.json();

  if (!data.states) return [];

  return data.states.map(parseStateVector).filter(
    (s) => s.latitude !== null && s.longitude !== null
  );
}

/** Convert metres/second to knots */
export function msToKnots(ms: number): number {
  return Math.round(ms * 1.94384);
}

/** Convert metres to feet */
export function mToFeet(m: number): number {
  return Math.round(m * 3.28084);
}
