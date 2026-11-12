import type { ProviderErrorKind } from './errors';

/**
 * Deterministic flight data status.
 *
 * Priority while a request is in flight is `loading`/`refreshing`; otherwise a
 * failure surfaces as `rate-limited` or `error`, stale last-good data as
 * `stale`, and a fresh snapshot as `ready`.
 */
export type FlightStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'stale'
  | 'error'
  | 'rate-limited';

export interface FlightStatusInput {
  /** False before the user selects a location or draws an area. */
  hasArea: boolean;
  /** True when a snapshot for the current area is available. */
  hasData: boolean;
  isLoading: boolean;
  hasError: boolean;
  /** Provider error kind, when the failure came from an adapter. */
  errorKind: ProviderErrorKind | null;
  dataAgeMs: number | null;
  staleAfterMs: number;
}

/** True when a snapshot is old enough to be considered stale. */
export function isStaleData(
  dataAgeMs: number | null,
  staleAfterMs: number,
): boolean {
  return (
    dataAgeMs !== null &&
    Number.isFinite(staleAfterMs) &&
    dataAgeMs >= staleAfterMs
  );
}

/** Resolve the single status shown by the UI for the current state. */
export function deriveFlightStatus(input: FlightStatusInput): FlightStatus {
  if (!input.hasArea) return 'idle';

  if (input.isLoading) {
    return input.hasData ? 'refreshing' : 'loading';
  }

  if (input.hasError) {
    return input.errorKind === 'rate-limited' ? 'rate-limited' : 'error';
  }

  if (!input.hasData) return 'idle';

  if (isStaleData(input.dataAgeMs, input.staleAfterMs)) return 'stale';

  return 'ready';
}

/** True while a request is active (first load or background refresh). */
export function isBusyStatus(status: FlightStatus): boolean {
  return status === 'loading' || status === 'refreshing';
}
