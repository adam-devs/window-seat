import type {
  EnrichmentAircraft,
  EnrichmentAirline,
  EnrichmentOrigin,
  FlightEnrichment,
} from './flightEnrichment';

export const ENRICHMENT_STORAGE_KEY = 'window-seat:enrichment:v2';
export const ENRICHMENT_CACHE_VERSION = 2;
export const ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const ENRICHMENT_MISSING_TTL_MS = 24 * 60 * 60 * 1_000;
export const ENRICHMENT_CACHE_LIMIT = 500;

export type EnrichmentCache = Record<string, FlightEnrichment>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : null;
}

function parseOrigin(value: unknown): EnrichmentOrigin | null {
  if (!isRecord(value)) return null;
  const origin: EnrichmentOrigin = {
    city: text(value.city),
    airportName: text(value.airportName),
    iata: text(value.iata),
    icao: text(value.icao),
    country: text(value.country),
    countryCode: text(value.countryCode),
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
    icaoType: text(value.icaoType),
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

function parseCachedEntry(value: unknown): FlightEnrichment | null {
  if (!isRecord(value)) return null;
  if (value.status !== 'ready' && value.status !== 'missing') return null;
  const fetchedAt = value.fetchedAt;
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null;

  const origin = parseOrigin(value.origin);
  const aircraft = parseAircraft(value.aircraft);
  const airline = parseAirline(value.airline);
  if (value.status === 'ready' && !origin && !aircraft && !airline) {
    return null;
  }

  return {
    status: value.status,
    origin,
    aircraft,
    airline,
    fetchedAt,
  };
}

/** True while a cached ready/missing entry is still inside its TTL. */
export function isEnrichmentFresh(
  entry: FlightEnrichment,
  now = Date.now(),
): boolean {
  if (entry.status !== 'ready' && entry.status !== 'missing') return false;
  const ttl =
    entry.status === 'missing'
      ? ENRICHMENT_MISSING_TTL_MS
      : ENRICHMENT_TTL_MS;
  return now - entry.fetchedAt >= 0 && now - entry.fetchedAt < ttl;
}

/** Drop stale/invalid entries and keep the most recently fetched 500. */
export function pruneEnrichmentCache(
  cache: EnrichmentCache,
  now = Date.now(),
): EnrichmentCache {
  const entries = Object.entries(cache)
    .filter(([, entry]) => isEnrichmentFresh(entry, now))
    .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
    .slice(0, ENRICHMENT_CACHE_LIMIT);
  return Object.fromEntries(entries);
}

/** Parse the versioned localStorage payload, skipping invalid entries. */
export function parseEnrichmentCache(
  raw: string | null,
  now = Date.now(),
): EnrichmentCache {
  if (!raw) return {};
  try {
    const payload: unknown = JSON.parse(raw);
    if (!isRecord(payload) || payload.version !== ENRICHMENT_CACHE_VERSION) {
      return {};
    }
    const entries = isRecord(payload.entries) ? payload.entries : {};
    const cache: EnrichmentCache = {};
    for (const [key, value] of Object.entries(entries)) {
      const entry = parseCachedEntry(value);
      if (entry) cache[key] = entry;
    }
    return pruneEnrichmentCache(cache, now);
  } catch {
    return {};
  }
}

export function serializeEnrichmentCache(cache: EnrichmentCache): string {
  return JSON.stringify({
    version: ENRICHMENT_CACHE_VERSION,
    entries: cache,
  });
}

export function readEnrichmentCache(
  storage: Storage | null | undefined,
  now = Date.now(),
): EnrichmentCache {
  if (!storage) return {};
  try {
    return parseEnrichmentCache(storage.getItem(ENRICHMENT_STORAGE_KEY), now);
  } catch {
    return {};
  }
}

/** Persist a pruned cache; storage failures degrade to the in-memory store. */
export function writeEnrichmentCache(
  storage: Storage | null | undefined,
  cache: EnrichmentCache,
  now = Date.now(),
): EnrichmentCache {
  const pruned = pruneEnrichmentCache(cache, now);
  if (!storage) return pruned;
  try {
    storage.setItem(ENRICHMENT_STORAGE_KEY, serializeEnrichmentCache(pruned));
  } catch {
    // Quota/private-mode failures are non-fatal.
  }
  return pruned;
}
