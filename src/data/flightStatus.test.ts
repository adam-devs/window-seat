import { describe, expect, it } from 'vitest';
import {
  deriveFlightStatus,
  isBusyStatus,
  isStaleData,
  type FlightStatusInput,
} from './flightStatus';

const base: FlightStatusInput = {
  hasArea: true,
  hasData: false,
  isLoading: false,
  hasError: false,
  errorKind: null,
  dataAgeMs: null,
  staleAfterMs: 90_000,
};

function status(overrides: Partial<FlightStatusInput> = {}) {
  return deriveFlightStatus({ ...base, ...overrides });
}

describe('deriveFlightStatus', () => {
  it('is idle before an area is selected', () => {
    expect(status({ hasArea: false, hasData: true })).toBe('idle');
  });

  it('is loading during the first request', () => {
    expect(status({ isLoading: true, dataAgeMs: null })).toBe('loading');
  });

  it('is refreshing during a background request with data', () => {
    expect(status({ isLoading: true, hasData: true, dataAgeMs: 2_000 })).toBe(
      'refreshing',
    );
  });

  it('is ready for a fresh snapshot', () => {
    expect(status({ hasData: true, dataAgeMs: 10_000 })).toBe('ready');
    expect(status({ hasData: true, dataAgeMs: 0 })).toBe('ready');
  });

  it('becomes stale at the threshold', () => {
    expect(status({ hasData: true, dataAgeMs: 89_999 })).toBe('ready');
    expect(status({ hasData: true, dataAgeMs: 90_000 })).toBe('stale');
    expect(status({ hasData: true, dataAgeMs: 300_000 })).toBe('stale');
  });

  it('reports a generic error', () => {
    expect(status({ hasData: true, hasError: true, errorKind: 'network' })).toBe(
      'error',
    );
    expect(status({ hasData: false, hasError: true })).toBe('error');
  });

  it('distinguishes rate limiting', () => {
    expect(
      status({ hasData: true, hasError: true, errorKind: 'rate-limited' }),
    ).toBe('rate-limited');
  });

  it('prefers loading/refreshing over a previous error', () => {
    expect(
      status({ isLoading: true, hasError: true, hasData: true }),
    ).toBe('refreshing');
    expect(status({ isLoading: true, hasError: true })).toBe('loading');
  });

  it('is idle when an area is set but no request has started', () => {
    expect(status({ hasArea: true })).toBe('idle');
  });

  it('treats an invalid stale threshold as never stale', () => {
    expect(
      status({ hasData: true, dataAgeMs: 500_000, staleAfterMs: Number.NaN }),
    ).toBe('ready');
  });
});

describe('status helpers', () => {
  it('reports busy statuses', () => {
    expect(isBusyStatus('loading')).toBe(true);
    expect(isBusyStatus('refreshing')).toBe(true);
    expect(isBusyStatus('stale')).toBe(false);
    expect(isBusyStatus('idle')).toBe(false);
  });

  it('detects stale ages at the threshold', () => {
    expect(isStaleData(null, 90_000)).toBe(false);
    expect(isStaleData(0, 90_000)).toBe(false);
    expect(isStaleData(89_999, 90_000)).toBe(false);
    expect(isStaleData(90_000, 90_000)).toBe(true);
    expect(isStaleData(500_000, 90_000)).toBe(true);
  });

  it('never treats data as stale with an invalid threshold', () => {
    expect(isStaleData(500_000, Number.NaN)).toBe(false);
    expect(isStaleData(500_000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
