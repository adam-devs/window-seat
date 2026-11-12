import type { Aircraft } from './types';

/**
 * Rolling observed-position history for aircraft trails.
 *
 * Only real fixes are recorded; dead-reckoned positions never enter the trail.
 * Points are keyed by the provider fix timestamp (falling back to last contact)
 * so repeated syncs of the same snapshot cannot duplicate a point. Aircraft
 * absent from the latest snapshot are dropped immediately.
 */

export const DEFAULT_TRAIL_AGE_MS = 120_000;
export const DEFAULT_TRAIL_MAX_POINTS = 60;

export interface TrailPoint {
  latitude: number;
  longitude: number;
  /** Provider fix timestamp used for ordering and pruning. */
  observedAtMs: number;
}

export interface TrailStoreOptions {
  maxAgeMs?: number;
  maxPoints?: number;
}

export interface AircraftTrailStore {
  /** Append fixes from a snapshot and prune old points/aircraft. */
  record(flights: Aircraft[], nowMs?: number): void;
  getTrail(icao24: string): TrailPoint[];
  lastObserved(icao24: string): TrailPoint | null;
  /** Number of aircraft with a trail. */
  size(): number;
  reset(): void;
}

function positiveOption(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? -1) > 0
    ? (value as number)
    : fallback;
}

export function createAircraftTrailStore(
  options: TrailStoreOptions = {},
): AircraftTrailStore {
  const maxAgeMs = positiveOption(options.maxAgeMs, DEFAULT_TRAIL_AGE_MS);
  const maxPoints = Math.max(
    1,
    Math.floor(positiveOption(options.maxPoints, DEFAULT_TRAIL_MAX_POINTS)),
  );
  const trails = new Map<string, TrailPoint[]>();

  function trim(points: TrailPoint[], nowMs: number): TrailPoint[] {
    const cutoff = nowMs - maxAgeMs;
    const fresh = points.filter((point) => point.observedAtMs >= cutoff);
    return fresh.length > maxPoints
      ? fresh.slice(fresh.length - maxPoints)
      : fresh;
  }

  return {
    record(flights, nowMs = Date.now()) {
      const seen = new Set<string>();

      for (const flight of flights) {
        const icao24 = flight.icao24;
        seen.add(icao24);

        const observedAtMs =
          flight.lastPositionMs ?? flight.lastContactMs;
        const observed = Number.isFinite(observedAtMs)
          ? observedAtMs
          : nowMs;
        const points = trails.get(icao24) ?? [];
        const last = points[points.length - 1];

        if (
          last === undefined ||
          observed > last.observedAtMs ||
          (observed === last.observedAtMs &&
            (last.latitude !== flight.latitude ||
              last.longitude !== flight.longitude))
        ) {
          points.push({
            latitude: flight.latitude,
            longitude: flight.longitude,
            observedAtMs: observed,
          });
        }

        const trimmed = trim(points, nowMs);
        if (trimmed.length === 0) {
          trails.delete(icao24);
        } else {
          trails.set(icao24, trimmed);
        }
      }

      for (const icao24 of Array.from(trails.keys())) {
        if (!seen.has(icao24)) trails.delete(icao24);
      }
    },

    getTrail(icao24) {
      return (trails.get(icao24) ?? []).map((point) => ({ ...point }));
    },

    lastObserved(icao24) {
      const points = trails.get(icao24);
      if (!points || points.length === 0) return null;
      return { ...points[points.length - 1] };
    },

    size() {
      return trails.size;
    },

    reset() {
      trails.clear();
    },
  };
}
