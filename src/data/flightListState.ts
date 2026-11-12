import type { SelectionMode } from '../types';
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
  | 'filtered'
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
  /** True when a search or non-default status filter can hide all rows. */
  filtersActive?: boolean;
  /** Selects area vs direction wording. Defaults to perimeter. */
  mode?: SelectionMode;
}

/** Returns the empty-state copy, or null when rows are on screen. */
export function deriveFlightListState(
  input: FlightListStateInput,
): FlightListState | null {
  const isView = input.mode === 'direction';

  if (!input.hasArea) {
    return {
      kind: 'no-area',
      message: isView
        ? 'Pin a view on the map to begin tracking.'
        : 'Draw a perimeter on the map to begin tracking.',
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
        message: `Couldn’t load aircraft for this ${
          isView ? 'view' : 'area'
        }. Retrying automatically.`,
      };
    case 'ready':
    case 'refreshing':
    case 'stale':
      if (input.filtersActive) {
        return {
          kind: 'filtered',
          message: 'No aircraft match the current filters.',
        };
      }
      return {
        kind: 'empty',
        message: isView
          ? 'No aircraft in this direction right now.'
          : 'No airborne aircraft in this area right now.',
      };
  }
}
