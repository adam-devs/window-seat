/**
 * Provider-neutral aircraft model.
 *
 * Units are SI throughout:
 * - altitude: metres
 * - speed / vertical rate: metres per second
 * - track: degrees clockwise from north
 * - timestamps: epoch milliseconds
 *
 * Field names intentionally mirror the existing UI-facing shape so the map and
 * panel can migrate without a wholesale rename. Provider-specific quirks belong
 * in adapters, not here.
 */

// TODO(M1.2.5): move `BoundingBox` here once UI imports are migrated.
import type { BoundingBox } from '../types';

/** Identifies the source of a snapshot. Extend when a second provider lands. */
export type ProviderId = 'opensky';

export interface Aircraft {
  /** ICAO 24-bit address, lowercase hex. Stable identity within a provider. */
  icao24: string;
  callsign: string | null;
  origin_country: string | null;

  /** Epoch ms of the provider's last contact with the aircraft. */
  lastContactMs: number;
  /** Epoch ms of the last known position, or null when not reported. */
  lastPositionMs: number | null;

  /** Always present: adapters drop records without a usable position. */
  latitude: number;
  longitude: number;

  /** Barometric altitude in metres. */
  baro_altitude: number | null;
  /** Geometric altitude in metres. */
  geo_altitude: number | null;
  on_ground: boolean;

  /** Ground speed in metres per second. */
  velocity: number | null;
  /** Track over ground in degrees clockwise from north. */
  true_track: number | null;
  /** Vertical rate in metres per second. */
  vertical_rate: number | null;

  squawk: string | null;
  spi: boolean;

  providerId: ProviderId;

  /**
   * Optional enrichment. Absent or null when the provider does not expose the
   * field; never synthesized from observer-relative data.
   */
  registration?: string | null;
  type?: string | null;
  operator?: string | null;
  /** Emitter category, when the provider supports it (OpenSky `extended=1`). */
  category?: number | null;
}

/** One successful provider response, including what it cost. */
export interface Snapshot {
  providerId: ProviderId;
  /** Epoch ms when the app received the response. */
  fetchedAt: number;
  /** Provider-reported snapshot timestamp, when available (epoch ms). */
  providerTimeMs?: number | null;
  aircraft: Aircraft[];
  /** Credits or requests consumed, for budget accounting. */
  cost?: number;
  /** Provider-reported remaining quota, when the response exposes it. */
  rateLimitRemaining?: number;
}

/** Optional fields a provider can populate. Used to hide unsupported UI. */
export interface ProviderCapabilities {
  registration: boolean;
  aircraftType: boolean;
  operator: boolean;
  /** Emitter category, e.g. OpenSky `extended=1`. */
  category: boolean;
  /** Provider reports position/contact timestamps. */
  positionTimestamps: boolean;
}

/**
 * Contract implemented by every data source.
 *
 * `fetchFlights` must:
 * - reject with an abort error when `signal` is aborted;
 * - drop records without usable coordinates;
 * - preserve `null` for unknown values rather than inventing defaults;
 * - return aircraft in SI units with epoch-ms timestamps.
 */
export interface FlightProvider {
  readonly id: ProviderId;
  readonly name: string;
  /** Shortest allowed gap between requests, from provider terms. */
  readonly minIntervalMs: number;
  /** Optional daily credit/request allowance. */
  readonly dailyBudget?: number;
  readonly capabilities: Readonly<ProviderCapabilities>;

  fetchFlights(bbox: BoundingBox, signal: AbortSignal): Promise<Snapshot>;
}
