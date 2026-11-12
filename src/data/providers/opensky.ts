import { config } from '../../config';
import type { BoundingBox } from '../../types';
import { ProviderError } from '../errors';
import {
  asFiniteNumber,
  asTrimmedString,
  isRecord,
  isValidLatitude,
  isValidLongitude,
  secondsToMs,
} from '../normalize';
import type { Aircraft, FlightProvider, ProviderCapabilities, Snapshot } from '../types';

/** OpenSky's hard floor; the request policy normally uses a slower cadence. */
export const OPENSKY_MIN_INTERVAL_MS = 10_000;
/** Standard account quota. Anonymous access is lower (400). */
export const OPENSKY_DAILY_BUDGET = 4_000;

const STATES_PATH = '/api/states/all';

export interface OpenSkyProviderOptions {
  /** Path prefix of the Vite proxy that injects OAuth2 credentials. */
  proxyBaseUrl?: string;
  /** Abort the request after this long. Set to 0 to disable. */
  timeoutMs?: number;
  /** Request the optional `category` field (`extended=1`). */
  includeExtended?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for deterministic timestamps in tests. */
  now?: () => number;
}

/**
 * Map one OpenSky positional state vector into the internal model.
 *
 * Returns null for malformed rows or rows without a usable position. Unknown
 * values stay null; nothing is synthesized.
 */
export function parseStateVectorRow(row: unknown): Aircraft | null {
  if (!Array.isArray(row) || row.length < 17) return null;

  const icao24 = asTrimmedString(row[0])?.toLowerCase();
  if (!icao24) return null;

  const latitude = asFiniteNumber(row[6]);
  const longitude = asFiniteNumber(row[5]);
  if (latitude === null || longitude === null) return null;
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  // Without a contact timestamp we cannot judge freshness, so drop the row.
  const lastContactMs = secondsToMs(row[4]);
  if (lastContactMs === null) return null;

  return {
    icao24,
    callsign: asTrimmedString(row[1]),
    origin_country: asTrimmedString(row[2]),
    lastContactMs,
    lastPositionMs: secondsToMs(row[3]),
    latitude,
    longitude,
    baro_altitude: asFiniteNumber(row[7]),
    on_ground: row[8] === true,
    velocity: asFiniteNumber(row[9]),
    true_track: asFiniteNumber(row[10]),
    vertical_rate: asFiniteNumber(row[11]),
    geo_altitude: asFiniteNumber(row[13]),
    squawk: asTrimmedString(row[14]),
    spi: row[15] === true,
    providerId: 'opensky',
    category: row.length > 17 ? asFiniteNumber(row[17]) : undefined,
  };
}

/** Validate and map a decoded `/states/all` payload. */
export function parseOpenSkyResponse(payload: unknown, fetchedAt: number): Snapshot {
  if (!isRecord(payload)) {
    throw new ProviderError('bad-response', 'OpenSky response was not an object');
  }

  const rawStates = payload.states;
  if (rawStates !== null && rawStates !== undefined && !Array.isArray(rawStates)) {
    throw new ProviderError('bad-response', 'OpenSky `states` was not an array');
  }

  const aircraft: Aircraft[] = [];
  if (Array.isArray(rawStates)) {
    for (const row of rawStates) {
      const parsed = parseStateVectorRow(row);
      if (parsed) aircraft.push(parsed);
    }
  }

  return {
    providerId: 'opensky',
    fetchedAt,
    providerTimeMs: secondsToMs(payload.time),
    aircraft,
  };
}

function readHeaderNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const seconds = readHeaderNumber(headers, 'x-rate-limit-retry-after-seconds');
  if (seconds !== null) return Math.max(0, Math.round(seconds * 1000));

  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;

  // `Retry-After` may be delta-seconds or an HTTP date.
  const delta = Number(retryAfter);
  if (Number.isFinite(delta)) return Math.max(0, Math.round(delta * 1000));

  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function errorForResponse(response: Response): ProviderError {
  const status = response.status;
  const retryAfterMs = parseRetryAfterMs(response.headers);

  if (status === 429) {
    return new ProviderError('rate-limited', 'OpenSky rate limit reached', {
      status,
      retryAfterMs,
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderError('unauthorized', 'OpenSky rejected the credentials', { status });
  }
  if (status >= 500) {
    return new ProviderError('server', `OpenSky server error (${status})`, { status });
  }
  return new ProviderError('http', `OpenSky request failed (${status})`, { status });
}

/**
 * Create the OpenSky adapter.
 *
 * Requests go through the local Vite proxy, which adds the OAuth2 bearer token
 * server-side. The adapter itself never sees credentials.
 */
export function createOpenSkyProvider(
  options: OpenSkyProviderOptions = {},
): FlightProvider {
  const {
    proxyBaseUrl = config.proxyBaseUrl,
    timeoutMs = config.requestTimeoutMs,
    includeExtended = false,
    fetchImpl = fetch,
    now = Date.now,
  } = options;

  const baseUrl = proxyBaseUrl.replace(/\/+$/, '');

  const capabilities: ProviderCapabilities = {
    registration: false,
    aircraftType: false,
    operator: false,
    category: includeExtended,
    positionTimestamps: true,
  };

  function buildUrl(bbox: BoundingBox) {
    const params = new URLSearchParams({
      lamin: String(bbox.lamin),
      lomin: String(bbox.lomin),
      lamax: String(bbox.lamax),
      lomax: String(bbox.lomax),
    });
    if (includeExtended) params.set('extended', '1');
    return `${baseUrl}${STATES_PATH}?${params.toString()}`;
  }

  async function request(url: string, signal: AbortSignal): Promise<Response> {
    if (signal.aborted) {
      throw new ProviderError('aborted', 'OpenSky request aborted before it started', {
        originalError: signal.reason,
      });
    }

    const controller = new AbortController();
    let timedOut = false;

    const abortFromCaller = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abortFromCaller, { once: true });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      return await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (error) {
      if (signal.aborted) {
        throw new ProviderError('aborted', 'OpenSky request aborted', {
          originalError: signal.reason,
        });
      }
      if (timedOut) {
        throw new ProviderError(
          'network',
          `OpenSky request timed out after ${timeoutMs} ms`,
          { originalError: error },
        );
      }
      throw new ProviderError('network', 'OpenSky request failed', { originalError: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener('abort', abortFromCaller);
    }
  }

  return {
    id: 'opensky',
    name: 'OpenSky Network',
    minIntervalMs: OPENSKY_MIN_INTERVAL_MS,
    dailyBudget: OPENSKY_DAILY_BUDGET,
    capabilities: Object.freeze(capabilities),

    async fetchFlights(bbox, signal) {
      const response = await request(buildUrl(bbox), signal);

      if (!response.ok) throw errorForResponse(response);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (signal.aborted) {
          throw new ProviderError('aborted', 'OpenSky request aborted', {
            originalError: signal.reason,
          });
        }
        throw new ProviderError('bad-response', 'OpenSky response was not valid JSON', {
          originalError: error,
        });
      }

      const snapshot = parseOpenSkyResponse(payload, now());
      const remaining = readHeaderNumber(response.headers, 'x-rate-limit-remaining');

      return remaining === null ? snapshot : { ...snapshot, rateLimitRemaining: remaining };
    },
  };
}
