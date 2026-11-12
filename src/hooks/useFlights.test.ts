// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoundingBox } from '../types';
import { config } from '../config';
import {
  BUDGET_STORAGE_KEY,
  localDayKey,
  nextLocalMidnight,
} from '../data/budget';
import type { Aircraft, Snapshot } from '../data/types';
import { useFlights } from './useFlights';

const provider = vi.hoisted(() => ({
  id: 'opensky' as const,
  name: 'OpenSky Test',
  minIntervalMs: 10_000,
  capabilities: {
    registration: false,
    aircraftType: false,
    operator: false,
    category: false,
    positionTimestamps: true,
  },
  fetchFlights: vi.fn(),
}));

vi.mock('../data/providers', () => ({
  getProvider: () => provider,
}));

const BBOX_A: BoundingBox = { lamin: 50, lomin: -1, lamax: 51, lomax: 0 };
const BBOX_B: BoundingBox = { lamin: 40, lomin: -2, lamax: 41, lomax: -1 };

function aircraft(icao24: string): Aircraft {
  return {
    icao24,
    callsign: null,
    origin_country: null,
    lastContactMs: Date.now(),
    lastPositionMs: null,
    latitude: 0,
    longitude: 0,
    baro_altitude: null,
    geo_altitude: null,
    on_ground: false,
    velocity: null,
    true_track: null,
    vertical_rate: null,
    squawk: null,
    spi: false,
    providerId: 'opensky',
  };
}

function snapshot(icao24: string, fetchedAt = Date.now()): Snapshot {
  return {
    providerId: 'opensky',
    fetchedAt,
    aircraft: [aircraft(icao24)],
  };
}

/** Flush pending promises and React updates inside `act`. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

interface PendingRequest {
  bbox: BoundingBox;
  signal: AbortSignal;
  resolve: (value: Snapshot) => void;
}

/** Provider mock that rejects on abort, like `fetch`. */
function trackRequests() {
  const requests: PendingRequest[] = [];

  provider.fetchFlights.mockImplementation(
    (bbox: BoundingBox, signal: AbortSignal) => {
      let resolve!: (value: Snapshot) => void;
      const promise = new Promise<Snapshot>((res, reject) => {
        resolve = res;
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
      requests.push({ bbox, signal, resolve });
      return promise;
    },
  );

  return requests;
}

/** Seed persisted spend for the local day so auto-refresh sees a real budget. */
function seedBudget(spent: number): void {
  localStorage.setItem(
    BUDGET_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      providers: {
        opensky: {
          day: localDayKey(Date.now()),
          spent,
          requests: 0,
          providerRemaining: null,
          observedBudget: null,
          updatedAt: Date.now(),
        },
      },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  });
  // Local noon keeps the time until daily reset deterministic across timezones.
  vi.setSystemTime(new Date(2026, 10, 12, 12, 0, 0));
  localStorage.clear();
  provider.fetchFlights.mockReset();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFlights', () => {
  it('transitions success → stale → recovery', async () => {
    provider.fetchFlights.mockImplementation(async () =>
      snapshot('abc123', Date.now()),
    );

    const { result } = renderHook(() => useFlights(BBOX_A));

    await flush();

    expect(provider.fetchFlights).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
    expect(result.current.isStale).toBe(false);
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['abc123']);
    expect(result.current.lastSuccessAt).toBe(Date.now());

    // Hiding pauses polling so the snapshot can age naturally.
    act(() => setVisibility('hidden'));

    act(() => {
      vi.advanceTimersByTime(config.staleAfterMs + 1_000);
    });

    expect(result.current.status).toBe('stale');
    expect(result.current.isStale).toBe(true);
    expect(result.current.dataAgeMs).toBeGreaterThanOrEqual(
      config.staleAfterMs,
    );
    // Last-good data is still there while stale.
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['abc123']);

    // Returning to the tab refreshes immediately.
    provider.fetchFlights.mockImplementation(async () =>
      snapshot('def456', Date.now()),
    );

    await act(async () => {
      setVisibility('visible');
      await Promise.resolve();
    });
    await flush();

    expect(provider.fetchFlights).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
    expect(result.current.isStale).toBe(false);
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['def456']);
  });

  it('aborts the previous request when the bbox changes', async () => {
    const requests = trackRequests();

    const { result, rerender } = renderHook(
      ({ bbox }: { bbox: BoundingBox | null }) => useFlights(bbox),
      { initialProps: { bbox: BBOX_A } },
    );

    await flush();

    expect(requests).toHaveLength(1);
    expect(requests[0].bbox).toEqual(BBOX_A);
    expect(requests[0].signal.aborted).toBe(false);
    expect(result.current.status).toBe('loading');

    rerender({ bbox: BBOX_B });
    await flush();

    // The old request must be aborted before the new area starts.
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1].bbox).toEqual(BBOX_B);
    expect(requests[1].signal.aborted).toBe(false);

    await act(async () => {
      requests[1].resolve(snapshot('new-area', Date.now()));
      await Promise.resolve();
    });
    await flush();

    expect(result.current.status).toBe('ready');
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['new-area']);
  });

  it('keeps last-good data through a failed refresh and recovers', async () => {
    provider.fetchFlights.mockResolvedValueOnce(
      snapshot('abc123', Date.now()),
    );
    provider.fetchFlights.mockRejectedValueOnce(
      new Error('OpenSky server error (503)'),
    );

    const { result } = renderHook(() => useFlights(BBOX_A));
    await flush();

    expect(result.current.status).toBe('ready');
    expect(result.current.flights).toHaveLength(1);

    // Let the manual-refresh floor elapse, then force a failed request.
    act(() => {
      vi.advanceTimersByTime(config.minManualRefreshMs);
    });

    let outcome: ReturnType<typeof result.current.refresh> | null = null;
    await act(async () => {
      outcome = result.current.refresh();
      await Promise.resolve();
    });
    await flush();

    expect(outcome).toBe('started');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('503');
    // Last-good aircraft stay on screen.
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['abc123']);

    provider.fetchFlights.mockResolvedValueOnce(
      snapshot('def456', Date.now()),
    );
    act(() => {
      vi.advanceTimersByTime(config.minManualRefreshMs);
    });

    await act(async () => {
      outcome = result.current.refresh();
      await Promise.resolve();
    });
    await flush();

    expect(outcome).toBe('started');
    expect(result.current.status).toBe('ready');
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['def456']);
  });

  it('joins an in-flight request on manual refresh', async () => {
    const requests = trackRequests();
    const { result } = renderHook(() => useFlights(BBOX_A));

    await flush();
    expect(requests).toHaveLength(1);

    let outcome: ReturnType<typeof result.current.refresh> | null = null;
    await act(async () => {
      outcome = result.current.refresh();
      await Promise.resolve();
    });

    expect(outcome).toBe('in-flight');
    expect(requests).toHaveLength(1);

    await act(async () => {
      requests[0].resolve(snapshot('abc123', Date.now()));
      await Promise.resolve();
    });
    await flush();

    expect(result.current.status).toBe('ready');
    expect(result.current.flights).toHaveLength(1);
  });

  it('honours the configured auto-refresh interval', async () => {
    provider.fetchFlights.mockImplementation(async () =>
      snapshot('abc123', Date.now()),
    );

    const { result } = renderHook(() =>
      useFlights(BBOX_A, { autoRefreshMs: 60_000 }),
    );
    await flush();

    expect(result.current.cadence?.intervalMs).toBe(60_000);
    expect(result.current.cadence?.reason).toBe('user');
    expect(provider.fetchFlights).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(provider.fetchFlights).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await flush();

    expect(provider.fetchFlights).toHaveBeenCalledTimes(2);
  });

  it('lengthens the cadence when the remaining budget requires it', async () => {
    seedBudget(3_000);
    provider.fetchFlights.mockImplementation(async () =>
      snapshot('abc123', Date.now()),
    );

    const { result } = renderHook(() => useFlights(BBOX_A));
    await flush();

    expect(result.current.cadence?.reason).toBe('budget');
    expect(result.current.cadence?.paused).toBe(false);
    const interval = result.current.cadence!.intervalMs;
    expect(interval).toBeGreaterThan(config.defaultRefreshMs);

    act(() => {
      vi.advanceTimersByTime(interval - 1);
    });
    expect(provider.fetchFlights).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await flush();

    expect(provider.fetchFlights).toHaveBeenCalledTimes(2);
  });

  it('pauses automatic polling at the budget threshold but allows manual refresh', async () => {
    seedBudget(3_600);
    provider.fetchFlights.mockImplementation(async () =>
      snapshot('manual', Date.now()),
    );

    const { result } = renderHook(() => useFlights(BBOX_A));
    await flush();

    expect(provider.fetchFlights).not.toHaveBeenCalled();
    expect(result.current.cadence?.paused).toBe(true);
    expect(result.current.cadence?.reason).toBe('budget');
    expect(result.current.nextRetryAt).toBe(nextLocalMidnight(Date.now()));

    // Manual refresh may use the reserve above the auto-pause threshold.
    let outcome: ReturnType<typeof result.current.refresh> | null = null;
    await act(async () => {
      outcome = result.current.refresh();
      await Promise.resolve();
    });
    await flush();

    expect(outcome).toBe('started');
    expect(provider.fetchFlights).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
    expect(result.current.flights.map((f) => f.icao24)).toEqual(['manual']);
    // Auto remains paused after the extra spend.
    expect(result.current.cadence?.paused).toBe(true);
  });
});
