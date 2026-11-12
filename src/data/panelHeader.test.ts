import { describe, expect, it } from 'vitest';
import { derivePanelHeader, formatUpdatedTime } from './panelHeader';
import type { PanelHeaderInput } from './panelHeader';

const updated = new Date(2026, 10, 12, 14, 32, 10);

const base: PanelHeaderInput = {
  hasArea: true,
  hasData: true,
  status: 'ready',
  lastUpdated: updated,
  dataAgeMs: 12_000,
  providerName: 'OpenSky Network',
};

describe('formatUpdatedTime', () => {
  it('formats a local HH:MM:SS clock time', () => {
    expect(formatUpdatedTime(updated)).toBe('14:32:10');
    expect(formatUpdatedTime(new Date(2026, 10, 12, 9, 5, 7))).toBe(
      '09:05:07',
    );
  });
});

describe('derivePanelHeader', () => {
  it('prompts for an area before one is selected', () => {
    expect(
      derivePanelHeader({
        ...base,
        hasArea: false,
        hasData: false,
        status: 'idle',
        lastUpdated: null,
        dataAgeMs: null,
      }),
    ).toEqual({
      text: 'No area selected',
      provider: 'via OpenSky Network',
      exactTime: null,
      firstLoad: false,
      busy: false,
      updated: false,
    });
  });

  it('marks the first load distinctly', () => {
    expect(
      derivePanelHeader({
        ...base,
        hasData: false,
        status: 'loading',
        lastUpdated: null,
        dataAgeMs: null,
      }),
    ).toEqual({
      text: 'Loading nearby flights…',
      provider: 'via OpenSky Network',
      exactTime: null,
      firstLoad: true,
      busy: true,
      updated: false,
    });
  });

  it('shows relative data age and appends a background refresh', () => {
    expect(
      derivePanelHeader({ ...base, status: 'refreshing' }),
    ).toEqual({
      text: 'Updated 12s ago · Refreshing…',
      provider: 'via OpenSky Network',
      exactTime: '14:32:10',
      firstLoad: false,
      busy: true,
      updated: true,
    });
  });

  it('shows only the age when data is ready', () => {
    expect(derivePanelHeader(base)).toEqual({
      text: 'Updated 12s ago',
      provider: 'via OpenSky Network',
      exactTime: '14:32:10',
      firstLoad: false,
      busy: false,
      updated: true,
    });
  });

  it('updates the age as the snapshot gets older', () => {
    expect(
      derivePanelHeader({ ...base, dataAgeMs: 90_000 }).text,
    ).toBe('Updated 1m ago');
    expect(
      derivePanelHeader({ ...base, dataAgeMs: 4_000 }).text,
    ).toBe('Updated just now');
  });

  it('keeps the age visible after a failed refresh', () => {
    expect(derivePanelHeader({ ...base, status: 'error' }).text).toBe(
      'Updated 12s ago · Refresh failed',
    );
    expect(
      derivePanelHeader({ ...base, status: 'rate-limited' }).text,
    ).toBe('Updated 12s ago · Rate limited');
  });

  it('leaves stale data to the status banner', () => {
    expect(derivePanelHeader({ ...base, status: 'stale' })).toEqual({
      text: 'Updated 12s ago',
      provider: 'via OpenSky Network',
      exactTime: '14:32:10',
      firstLoad: false,
      busy: false,
      updated: true,
    });
  });

  it('says no data yet for an area with no successful snapshot', () => {
    expect(
      derivePanelHeader({
        ...base,
        hasData: false,
        status: 'error',
        lastUpdated: null,
        dataAgeMs: null,
      }),
    ).toEqual({
      text: 'No data yet',
      provider: 'via OpenSky Network',
      exactTime: null,
      firstLoad: false,
      busy: false,
      updated: false,
    });
  });

  it('falls back to the exact time when no age is available', () => {
    expect(derivePanelHeader({ ...base, dataAgeMs: null }).text).toBe(
      'Updated at 14:32:10',
    );
  });

  it('omits the provider line when no name is supplied', () => {
    expect(
      derivePanelHeader({ ...base, providerName: null }).provider,
    ).toBeNull();
    expect(
      derivePanelHeader({ ...base, providerName: '   ' }).provider,
    ).toBeNull();
  });
});
