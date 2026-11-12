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
  /** Display heading in degrees at `nowMs`, or null when unknown/absent. */
  headingAt(icao24: string, nowMs?: number): number | null;
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
  /** Display heading at the moment the snapshot arrived. */
  headingFrom: number | null;
  headingTo: number | null;
}

/** Normalize a heading to the [0, 360) range. */
export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

/** Signed shortest rotation from `from` to `to`, in (-180, 180]. */
export function shortestHeadingDelta(from: number, to: number): number {
  let delta = normalizeHeading(to) - normalizeHeading(from);
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Interpolate rotation along the shortest path. */
export function interpolateHeading(
  from: number,
  to: number,
  progress: number,
): number {
  const t = Math.min(1, Math.max(0, progress));
  return normalizeHeading(from + shortestHeadingDelta(from, to) * t);
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

  function headingAt(
    icao24: string,
    nowMs = Date.now(),
  ): number | null {
    const state = states.get(icao24);
    if (!state) return null;
    if (state.headingTo === null) return state.headingFrom;
    if (state.headingFrom === null) return state.headingTo;

    const duration = correctionMs();
    if (duration <= 0) return state.headingTo;

    const elapsed = nowMs - state.correctionStartedAt;
    if (elapsed >= duration) return state.headingTo;

    return interpolateHeading(
      state.headingFrom,
      state.headingTo,
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
        const previousHeading = previous
          ? headingAt(flight.icao24, nowMs)
          : null;
        const nextHeading =
          flight.true_track !== null &&
          Number.isFinite(flight.true_track)
            ? normalizeHeading(flight.true_track)
            : null;

        states.set(flight.icao24, {
          aircraft: flight,
          correctionFrom,
          correctionStartedAt: nowMs,
          headingFrom: previousHeading ?? nextHeading,
          headingTo: nextHeading,
        });
      }

      for (const id of Array.from(states.keys())) {
        if (!seen.has(id)) states.delete(id);
      }
    },

    positionAt,
    headingAt,

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
