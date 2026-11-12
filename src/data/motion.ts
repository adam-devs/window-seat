import type { Aircraft } from './types';
import {
  projectAircraftPosition,
  type ExtrapolationOptions,
  type GeoPoint,
} from './extrapolate';

/**
 * Per-aircraft motion state for the map animation loop.
 *
 * The tracker is deliberately React-free. A single `requestAnimationFrame`
 * loop asks it for positions each frame; fresh snapshots call `sync`, which
 * starts a short eased correction from the current display position to the new
 * projection instead of snapping. Aircraft missing from the latest snapshot are
 * pruned immediately.
 */

export const DEFAULT_CORRECTION_MS = 700;

export interface AircraftMotionOptions extends ExtrapolationOptions {
  /** Duration of the eased correction after a fresh snapshot. */
  correctionMs?: number;
}

export interface AircraftMotionTracker {
  /** Replace the current aircraft set and start corrections where needed. */
  sync(flights: Aircraft[], nowMs?: number): void;
  /** Display position for one aircraft at `nowMs`, or null when absent. */
  positionAt(icao24: string, nowMs?: number): GeoPoint | null;
  /** True when the aircraft is in the current snapshot. */
  has(icao24: string): boolean;
  /** Number of tracked aircraft. */
  size(): number;
  /** Apply a new cadence/correction configuration without losing state. */
  setOptions(options: AircraftMotionOptions): void;
  /** Forget every aircraft. */
  reset(): void;
}

interface MotionState {
  aircraft: Aircraft;
  /** Display position at the moment the snapshot arrived. */
  correctionFrom: GeoPoint | null;
  correctionStartedAt: number;
}

/** Cubic ease-out in [0, 1]. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** Shortest-path linear interpolation between two geographic points. */
export function interpolateGeo(
  from: GeoPoint,
  to: GeoPoint,
  progress: number,
): GeoPoint {
  const t = Math.min(1, Math.max(0, progress));
  let longitudeDelta = to.longitude - from.longitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;

  const longitude = from.longitude + longitudeDelta * t;
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;

  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: wrapped === -180 ? 180 : wrapped,
  };
}

export function createAircraftMotionTracker(
  options: AircraftMotionOptions = {},
): AircraftMotionTracker {
  let currentOptions: AircraftMotionOptions = { ...options };
  const states = new Map<string, MotionState>();

  function correctionMs(): number {
    const value = currentOptions.correctionMs;
    return Number.isFinite(value) && (value ?? -1) >= 0
      ? (value as number)
      : DEFAULT_CORRECTION_MS;
  }

  function positionAt(icao24: string, nowMs = Date.now()): GeoPoint | null {
    const state = states.get(icao24);
    if (!state) return null;

    const projected = projectAircraftPosition(
      state.aircraft,
      nowMs,
      currentOptions,
    );

    if (state.correctionFrom === null) return projected;

    const duration = correctionMs();
    if (duration <= 0) return projected;

    const elapsed = nowMs - state.correctionStartedAt;
    if (elapsed >= duration) return projected;

    return interpolateGeo(
      state.correctionFrom,
      projected,
      easeOutCubic(elapsed / duration),
    );
  }

  return {
    sync(flights, nowMs = Date.now()) {
      const seen = new Set<string>();

      for (const flight of flights) {
        seen.add(flight.icao24);
        const previous = states.get(flight.icao24);
        const correctionFrom = previous ? positionAt(flight.icao24, nowMs) : null;

        states.set(flight.icao24, {
          aircraft: flight,
          correctionFrom,
          correctionStartedAt: nowMs,
        });
      }

      for (const id of Array.from(states.keys())) {
        if (!seen.has(id)) states.delete(id);
      }
    },

    positionAt,

    has(icao24) {
      return states.has(icao24);
    },

    size() {
      return states.size;
    },

    setOptions(next) {
      currentOptions = { ...currentOptions, ...next };
    },

    reset() {
      states.clear();
    },
  };
}
