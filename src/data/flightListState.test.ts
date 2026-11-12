import { describe, expect, it } from 'vitest';
import { deriveFlightListState } from './flightListState';

const base = {
  hasArea: true,
  status: 'ready' as const,
  visibleCount: 0,
};

describe('deriveFlightListState', () => {
  it('returns nothing while rows are visible', () => {
    for (const status of [
      'loading',
      'refreshing',
      'ready',
      'stale',
      'error',
      'rate-limited',
    ] as const) {
      expect(
        deriveFlightListState({ ...base, status, visibleCount: 3 }),
      ).toBeNull();
    }
  });

  it('prompts for an area before one is selected', () => {
    expect(
      deriveFlightListState({ ...base, hasArea: false, status: 'idle' }),
    ).toEqual({
      kind: 'no-area',
      message: 'Set a search area on the map to begin tracking.',
    });
  });

  it('shows a loading state during the first request', () => {
    expect(
      deriveFlightListState({ ...base, status: 'loading' }),
    ).toEqual({ kind: 'loading', message: 'Loading nearby aircraft…' });
  });

  it('waits quietly when a hidden tab defers the first request', () => {
    expect(deriveFlightListState({ ...base, status: 'idle' })).toEqual({
      kind: 'waiting',
      message: 'Waiting for flight data…',
    });
  });

  it('does not claim the area is empty after a failure', () => {
    for (const status of ['error', 'rate-limited'] as const) {
      expect(deriveFlightListState({ ...base, status })).toEqual({
        kind: 'unavailable',
        message: 'Couldn’t load aircraft for this area. Retrying automatically.',
      });
    }
  });

  it('reports a genuinely empty area only with fresh-enough data', () => {
    for (const status of ['ready', 'refreshing', 'stale'] as const) {
      expect(deriveFlightListState({ ...base, status })).toEqual({
        kind: 'empty',
        message: 'No airborne aircraft in this area right now.',
      });
    }
  });
});
