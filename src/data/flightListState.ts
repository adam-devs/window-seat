import type { FlightStatus } from './flightStatus';

/**
 * Why the flight list is empty.
 *
 * The panel keeps last-good rows visible whenever a snapshot exists, so this
 * model only runs when there is nothing to show. It separates "no area chosen"
 * from "loading", "provider unavailable", and a genuinely empty area so the
 * panel never claims there are no aircraft when the truth is that data failed.
 */
export type FlightListStateKind =
  | 'no-area'
  | 'loading'
  | 'waiting'
  | 'unavailable'
  | 'empty';

export interface FlightListState {
  kind: FlightListStateKind;
  message: string;
}

export interface FlightListStateInput {
  hasArea: boolean;
  status: FlightStatus;
  /** Number of rows that would actually be rendered (usually airborne). */
  visibleCount: number;
}

/** Returns the empty-state copy, or null when rows are on screen. */
export function deriveFlightListState(
  input: FlightListStateInput,
): FlightListState | null {
  if (!input.hasArea) {
    return {
      kind: 'no-area',
      message: 'Set a search area on the map to begin tracking.',
    };
  }

  if (input.visibleCount > 0) return null;

  switch (input.status) {
    case 'loading':
      return { kind: 'loading', message: 'Loading nearby aircraft…' };
    case 'idle':
      return { kind: 'waiting', message: 'Waiting for flight data…' };
    case 'error':
    case 'rate-limited':
      return {
        kind: 'unavailable',
        message: 'Couldn’t load aircraft for this area. Retrying automatically.',
      };
    case 'ready':
    case 'refreshing':
    case 'stale':
      return {
        kind: 'empty',
        message: 'No airborne aircraft in this area right now.',
      };
  }
}
