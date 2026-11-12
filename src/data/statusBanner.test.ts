import { describe, expect, it } from 'vitest';
import {
  deriveStatusBanner,
  formatClockTime,
  formatDataAge,
  type StatusBannerInput,
} from './statusBanner';

const base: StatusBannerInput = {
  status: 'ready',
  online: true,
  hasData: true,
  error: null,
  dataAgeMs: 12_000,
  nextRetryAt: null,
  providerName: 'OpenSky Network',
};

describe('formatDataAge', () => {
  it('formats recent, seconds, minutes, and hours', () => {
    expect(formatDataAge(null)).toBe('unknown');
    expect(formatDataAge(Number.NaN)).toBe('unknown');
    expect(formatDataAge(-1)).toBe('unknown');
    expect(formatDataAge(4_000)).toBe('just now');
    expect(formatDataAge(12_000)).toBe('12s ago');
    expect(formatDataAge(125_000)).toBe('2m ago');
    expect(formatDataAge(2 * 60 * 60 * 1000)).toBe('2h ago');
  });
});

describe('formatClockTime', () => {
  it('returns a local HH:MM clock time or null', () => {
    const at = new Date(2026, 10, 12, 14, 5, 0).getTime();
    expect(formatClockTime(at)).toBe('14:05');
    expect(formatClockTime(null)).toBeNull();
    expect(formatClockTime(Number.NaN)).toBeNull();
  });
});

describe('deriveStatusBanner', () => {
  it('shows nothing for idle, loading, refreshing, or ready states', () => {
    for (const status of ['idle', 'loading', 'refreshing', 'ready'] as const) {
      expect(deriveStatusBanner({ ...base, status })).toBeNull();
    }
  });

  it('prioritises offline over other states and keeps last data visible', () => {
    const banner = deriveStatusBanner({
      ...base,
      status: 'error',
      online: false,
      error: 'Network request failed',
    });

    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('error');
    expect(banner!.title).toBe("You're offline");
    expect(banner!.detail).toContain('last data received 12s ago');
    expect(banner!.showRefresh).toBe(false);
  });

  it('explains an offline first load', () => {
    const banner = deriveStatusBanner({
      ...base,
      status: 'loading',
      online: false,
      hasData: false,
      dataAgeMs: null,
    });

    expect(banner!.title).toBe("You're offline");
    expect(banner!.detail).toBe(
      'Connect to the internet to load nearby aircraft.',
    );
  });

  it('describes a rate limit with the next retry time', () => {
    const resetAt = new Date(2026, 10, 12, 18, 30, 0).getTime();
    const banner = deriveStatusBanner({
      ...base,
      status: 'rate-limited',
      nextRetryAt: resetAt,
    });

    expect(banner!.tone).toBe('warning');
    expect(banner!.title).toBe('OpenSky Network rate limit reached');
    expect(banner!.detail).toContain('resumes around 18:30');
    expect(banner!.showRefresh).toBe(false);
  });

  it('falls back to provider-agnostic copy without a reset time', () => {
    const banner = deriveStatusBanner({
      ...base,
      status: 'rate-limited',
      providerName: undefined,
      nextRetryAt: null,
    });

    expect(banner!.title).toBe('Flight data provider rate limit reached');
    expect(banner!.detail).toContain('paused until the limit resets');
  });

  it('keeps the error message alongside retained data', () => {
    const banner = deriveStatusBanner({
      ...base,
      status: 'error',
      error: 'OpenSky server error (503)',
    });

    expect(banner!.tone).toBe('error');
    expect(banner!.title).toBe("Couldn't update flight data");
    expect(banner!.detail).toBe(
      'OpenSky server error (503) Showing the last data received.',
    );
    expect(banner!.showRefresh).toBe(true);
  });

  it('uses a fallback message when an error has no data or text', () => {
    const banner = deriveStatusBanner({
      ...base,
      status: 'error',
      hasData: false,
      error: null,
    });

    expect(banner!.detail).toBe('The flight data provider is unavailable.');
  });

  it('shows stale data with its age and offers a retry', () => {
    const banner = deriveStatusBanner({
      ...base,
      status: 'stale',
      dataAgeMs: 95_000,
    });

    expect(banner!.tone).toBe('warning');
    expect(banner!.title).toBe('Flight data is out of date');
    expect(banner!.detail).toBe('Last update 1m ago. Retrying automatically.');
    expect(banner!.showRefresh).toBe(true);
  });
});
