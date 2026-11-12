// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlightEnrichment } from './useFlightEnrichment';
import { ENRICHMENT_STORAGE_KEY } from '../data/enrichmentCache';

const payload = {
  response: {
    aircraft: {
      type: 'A321-231',
      icao_type: 'A321',
      manufacturer: 'Airbus',
      registration: 'D-AIAA',
    },
    flightroute: {
      callsign: 'EXS1286',
      origin: {
        country_iso_name: 'ES',
        country_name: 'Spain',
        iata_code: 'LEI',
        icao_code: 'LEAM',
        municipality: 'Almería',
        name: 'Almería Airport',
      },
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useFlightEnrichment', () => {
  it('requests, parses, and caches a visible flight', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFlightEnrichment());
    act(() => {
      result.current.requestEnrichment('ABC123', 'EXS1286');
    });

    await waitFor(() => {
      expect(result.current.getEnrichment('ABC123', 'EXS1286').status).toBe(
        'ready',
      );
    });

    const enrichment = result.current.getEnrichment('ABC123', 'EXS1286');
    expect(enrichment.origin?.city).toBe('Almería');
    expect(enrichment.aircraft?.icaoType).toBe('A321');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/adsbdb/v0/aircraft/abc123?callsign=EXS1286',
    );
    expect(localStorage.getItem(ENRICHMENT_STORAGE_KEY)).toContain('Almería');
  });

  it('deduplicates in-flight and cached requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFlightEnrichment());
    act(() => {
      result.current.requestEnrichment('abc123', 'EXS1286');
      result.current.requestEnrichment('abc123', 'EXS1286');
    });

    await waitFor(() => {
      expect(result.current.getEnrichment('abc123', 'EXS1286').status).toBe(
        'ready',
      );
    });
    act(() => {
      result.current.requestEnrichment('abc123', 'EXS1286');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches unknown callsigns instead of retrying immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFlightEnrichment());
    act(() => {
      result.current.requestEnrichment('abc123', 'NOPE');
    });

    await waitFor(() => {
      expect(result.current.getEnrichment('abc123', 'NOPE').status).toBe(
        'missing',
      );
    });

    act(() => {
      result.current.requestEnrichment('abc123', 'NOPE');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks transient failures and waits before retrying', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFlightEnrichment());
    act(() => {
      result.current.requestEnrichment('abc123', 'EXS1286');
    });

    await waitFor(() => {
      expect(result.current.getEnrichment('abc123', 'EXS1286').status).toBe(
        'error',
      );
    });
    const failed = result.current.getEnrichment('abc123', 'EXS1286');
    expect(failed.retryAt).toBeGreaterThan(Date.now());

    act(() => {
      result.current.requestEnrichment('abc123', 'EXS1286');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rehydrates a persisted result without another request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useFlightEnrichment());
    act(() => {
      first.result.current.requestEnrichment('abc123', 'EXS1286');
    });
    await waitFor(() => {
      expect(first.result.current.getEnrichment('abc123', 'EXS1286').status).toBe(
        'ready',
      );
    });
    first.unmount();

    fetchMock.mockClear();
    const second = renderHook(() => useFlightEnrichment());
    expect(second.result.current.getEnrichment('abc123', 'EXS1286').status).toBe(
      'ready',
    );

    act(() => {
      second.result.current.requestEnrichment('abc123', 'EXS1286');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests aircraft-only data when no callsign is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ response: { aircraft: { icao_type: 'B738' } } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFlightEnrichment());
    act(() => {
      result.current.requestEnrichment('abc123', null);
    });

    await waitFor(() => {
      expect(result.current.getEnrichment('abc123', null).status).toBe('ready');
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/adsbdb/v0/aircraft/abc123');
  });
});
