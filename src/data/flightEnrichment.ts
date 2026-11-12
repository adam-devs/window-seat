export interface EnrichmentOrigin {
  city: string | null;
  airportName: string | null;
  iata: string | null;
  icao: string | null;
  country: string | null;
  countryCode: string | null;
}

export interface EnrichmentAircraft {
  manufacturer: string | null;
  type: string | null;
  icaoType: string | null;
  registration: string | null;
}

export interface EnrichmentAirline {
  name: string | null;
  icao: string | null;
  iata: string | null;
  country: string | null;
}

export type EnrichmentStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'missing'
  | 'error';

/**
 * Resolved callsign/aircraft metadata.
 *
 * `ready` may have only an origin, only an aircraft, or both. `missing` means
 * adsbdb had no usable record; `error` is a transient failure with a retry
 * deadline and is never persisted.
 */
export interface FlightEnrichment {
  status: EnrichmentStatus;
  origin: EnrichmentOrigin | null;
  aircraft: EnrichmentAircraft | null;
  airline: EnrichmentAirline | null;
  fetchedAt: number;
  retryAt?: number;
}

const IDLE: FlightEnrichment = {
  status: 'idle',
  origin: null,
  aircraft: null,
  airline: null,
  fetchedAt: 0,
};

export function idleEnrichment(): FlightEnrichment {
  return IDLE;
}

/** Stable cache/request key. Callsigns are case-insensitive. */
export function enrichmentKey(
  icao24: string,
  callsign: string | null | undefined,
): string {
  return `${icao24.trim().toLowerCase()}:${(callsign ?? '')
    .trim()
    .toUpperCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function countryCode(value: unknown): string | null {
  const code = text(value)?.toUpperCase() ?? null;
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

function parseOrigin(value: unknown): EnrichmentOrigin | null {
  if (!isRecord(value)) return null;
  const origin: EnrichmentOrigin = {
    city: text(value.municipality),
    airportName: text(value.name),
    iata: text(value.iata_code),
    icao: text(value.icao_code),
    country: text(value.country_name),
    countryCode: countryCode(value.country_iso_name),
  };
  return origin.city ||
    origin.airportName ||
    origin.iata ||
    origin.icao ||
    origin.country
    ? origin
    : null;
}

function parseAircraft(value: unknown): EnrichmentAircraft | null {
  if (!isRecord(value)) return null;
  const aircraft: EnrichmentAircraft = {
    manufacturer: text(value.manufacturer),
    type: text(value.type),
    icaoType: text(value.icao_type),
    registration: text(value.registration),
  };
  return aircraft.manufacturer ||
    aircraft.type ||
    aircraft.icaoType ||
    aircraft.registration
    ? aircraft
    : null;
}

function parseAirline(value: unknown): EnrichmentAirline | null {
  if (!isRecord(value)) return null;
  const airline: EnrichmentAirline = {
    name: text(value.name),
    icao: text(value.icao),
    iata: text(value.iata),
    country: text(value.country),
  };
  return airline.name || airline.icao || airline.iata || airline.country
    ? airline
    : null;
}

/**
 * Parse the adsbdb `aircraft + callsign` response.
 *
 * Returns null when the payload contains neither aircraft nor route data; the
 * caller treats that as a missing lookup rather than a hard failure.
 */
export function parseFlightEnrichment(
  payload: unknown,
  now = Date.now(),
): FlightEnrichment | null {
  if (!isRecord(payload) || !isRecord(payload.response)) return null;
  const response = payload.response;
  const aircraft = parseAircraft(response.aircraft);
  const flightroute = isRecord(response.flightroute)
    ? response.flightroute
    : null;

  // adsbdb nests origin/destination inside flightroute; some responses also
  // expose a top-level origin. Accept both.
  const routeOrigin =
    (flightroute ? parseOrigin(flightroute.origin) : null) ??
    parseOrigin(response.origin);
  const airline =
    (flightroute ? parseAirline(flightroute.airline) : null) ??
    parseAirline(response.airline);

  if (!routeOrigin && !aircraft && !airline) return null;

  return {
    status: 'ready',
    origin: routeOrigin,
    aircraft,
    airline,
    fetchedAt: now,
  };
}

/** Convert an ISO 3166-1 alpha-2 country code to a regional-indicator flag. */
export function countryCodeToFlag(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  return String.fromCodePoint(
    ...[...normalized].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

/** Human origin city, falling back to the airport name or code. */
export function originCityLabel(origin: EnrichmentOrigin | null): string | null {
  return (
    origin?.city ??
    origin?.airportName ??
    origin?.icao ??
    origin?.iata ??
    null
  );
}

/** Compact origin code such as `LEI / LEAM`. */
export function originCodeLabel(origin: EnrichmentOrigin | null): string | null {
  if (!origin) return null;
  if (origin.iata && origin.icao) return `${origin.iata} / ${origin.icao}`;
  return origin.iata ?? origin.icao;
}

/** Manufacturer + model, with the ICAO type as a fallback. */
export function aircraftTypeLabel(
  aircraft: EnrichmentAircraft | null,
): string | null {
  if (!aircraft) return null;
  if (aircraft.manufacturer && aircraft.type) {
    return `${aircraft.manufacturer} ${aircraft.type}`;
  }
  return aircraft.type ?? aircraft.manufacturer ?? aircraft.icaoType;
}

/** The origin airport name with its code appended, or null. */
export function originAirportLabel(origin: EnrichmentOrigin | null): string | null {
  if (!origin) return null;
  const code = originCodeLabel(origin);
  if (origin.airportName && code) return `${origin.airportName} (${code})`;
  return origin.airportName ?? code;
}

/** Airline display name, falling back to its codes. */
export function airlineNameLabel(
  airline: EnrichmentAirline | null,
): string | null {
  return (
    airline?.name ??
    airline?.icao ??
    airline?.iata ??
    null
  );
}

/** Airline code label such as `EXS / LS`. */
export function airlineCodeLabel(
  airline: EnrichmentAirline | null,
): string | null {
  const codes = [airline?.icao, airline?.iata].filter(
    (code): code is string => Boolean(code),
  );
  return codes.length > 0 ? codes.join(' / ') : null;
}
