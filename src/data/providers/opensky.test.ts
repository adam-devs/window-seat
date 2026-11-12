import { describe, expect, it } from 'vitest';
import { ProviderError, isAbortError, isProviderError } from '../errors';
import {
  createOpenSkyProvider,
  parseOpenSkyResponse,
  parseStateVectorRow,
} from './opensky';
import {
  BBOX,
  EMPTY_STATES_RESPONSE,
  MIXED_STATES_RESPONSE,
  NULL_STATES_RESPONSE,
  SECOND_ROW,
  STATES_RESPONSE,
  VALID_ROW,
  rowWith,
} from './__fixtures__/opensky';

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

const neverAbortableFetch = (
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });

describe('parseStateVectorRow', () => {
  it('maps a valid row into SI units and epoch milliseconds', () => {
    const aircraft = parseStateVectorRow(VALID_ROW);

    expect(aircraft).not.toBeNull();
    expect(aircraft).toMatchObject({
      icao24: 'abc123',
      callsign: 'BAW123',
      origin_country: 'United Kingdom',
      lastContactMs: 1_700_000_001_000,
      lastPositionMs: 1_700_000_000_000,
      latitude: 51.5072,
      longitude: -0.1276,
      baro_altitude: 10_000,
      geo_altitude: 10_200,
      on_ground: false,
      velocity: 250,
      true_track: 90,
      vertical_rate: -1.5,
      squawk: '7000',
      spi: false,
      providerId: 'opensky',
      category: 3,
    });
  });

  it('preserves unknowns as null instead of inventing values', () => {
    const aircraft = parseStateVectorRow(SECOND_ROW);

    expect(aircraft).toMatchObject({
      callsign: null,
      baro_altitude: null,
      geo_altitude: null,
      velocity: null,
      true_track: null,
      vertical_rate: null,
      squawk: null,
      category: undefined,
      on_ground: true,
    });
  });

  it('does not coerce numeric strings', () => {
    const aircraft = parseStateVectorRow(rowWith(7, '10000'));

    expect(aircraft).not.toBeNull();
    expect(aircraft?.baro_altitude).toBeNull();
  });

  it.each([
    ['no longitude', rowWith(5, null)],
    ['no latitude', rowWith(6, null)],
    ['latitude out of range', rowWith(6, 91)],
    ['longitude out of range', rowWith(5, 181)],
    ['blank identity', rowWith(0, '   ')],
    ['no contact timestamp', rowWith(4, null)],
    ['truncated row', ['short-row']],
    ['not an array', { 0: 'abc123' }],
    ['null', null],
  ])('drops %s', (_label, row) => {
    expect(parseStateVectorRow(row)).toBeNull();
  });

  it('treats a whitespace-only callsign as unknown', () => {
    expect(parseStateVectorRow(rowWith(1, '   '))?.callsign).toBeNull();
  });
});

describe('parseOpenSkyResponse', () => {
  it('maps valid rows and keeps provider timestamps', () => {
    const snapshot = parseOpenSkyResponse(STATES_RESPONSE, 123);

    expect(snapshot.providerId).toBe('opensky');
    expect(snapshot.fetchedAt).toBe(123);
    expect(snapshot.providerTimeMs).toBe(1_700_000_002_000);
    expect(snapshot.aircraft).toHaveLength(2);
  });

  it('drops unusable rows from a mixed payload', () => {
    expect(parseOpenSkyResponse(MIXED_STATES_RESPONSE, 0).aircraft).toHaveLength(2);
  });

  it.each([
    ['null states', NULL_STATES_RESPONSE],
    ['empty states', EMPTY_STATES_RESPONSE],
    ['missing states', { time: 1 }],
  ])('returns an empty snapshot for %s', (_label, payload) => {
    expect(parseOpenSkyResponse(payload, 0).aircraft).toEqual([]);
  });

  it.each([
    ['null payload', null],
    ['array payload', []],
    ['non-array states', { states: 'nope' }],
    ['primitive payload', 'nope'],
  ])('rejects %s as bad-response', (_label, payload) => {
    expect(() => parseOpenSkyResponse(payload, 0)).toThrowError(ProviderError);
  });
});

describe('createOpenSkyProvider', () => {
  it('exposes provider metadata and base capabilities', () => {
    const provider = createOpenSkyProvider();

    expect(provider.id).toBe('opensky');
    expect(provider.name).toBe('OpenSky Network');
    expect(provider.minIntervalMs).toBe(10_000);
    expect(provider.dailyBudget).toBe(4_000);
    expect(provider.capabilities).toMatchObject({
      registration: false,
      aircraftType: false,
      operator: false,
      category: false,
      positionTimestamps: true,
    });
    expect(Object.isFrozen(provider.capabilities)).toBe(true);
  });

  it('advertises category support when extended data is requested', () => {
    expect(createOpenSkyProvider({ includeExtended: true }).capabilities.category).toBe(true);
  });

  it('builds a proxied bbox request and returns a snapshot', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;

    const provider = createOpenSkyProvider({
      proxyBaseUrl: '/opensky/',
      now: () => 42,
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenInit = init;
        return jsonResponse(STATES_RESPONSE, { 'x-rate-limit-remaining': '3990' });
      },
    });

    const snapshot = await provider.fetchFlights(BBOX, new AbortController().signal);

    expect(seenUrl).toBe(
      '/opensky/api/states/all?lamin=51.4&lomin=-0.2&lamax=51.6&lomax=0.1',
    );
    expect(seenInit?.cache).toBe('no-store');
    expect(seenInit?.headers).toEqual({ Accept: 'application/json' });
    expect(snapshot.fetchedAt).toBe(42);
    expect(snapshot.rateLimitRemaining).toBe(3990);
    expect(snapshot.aircraft).toHaveLength(2);
  });

  it('adds extended=1 when enabled', async () => {
    let seenUrl = '';

    const provider = createOpenSkyProvider({
      includeExtended: true,
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse(STATES_RESPONSE);
      },
    });

    await provider.fetchFlights(BBOX, new AbortController().signal);
    expect(seenUrl).toContain('extended=1');
  });

  it('maps 429 responses to rate-limited with a retry delay', async () => {
    const limited = createOpenSkyProvider({
      fetchImpl: async () =>
        new Response('', {
          status: 429,
          headers: { 'x-rate-limit-retry-after-seconds': '30' },
        }),
    });

    await expect(
      limited.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'rate-limited', retryAfterMs: 30_000 });
  });

  it('parses numeric Retry-After seconds', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '12' } }),
    });

    await expect(
      provider.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'rate-limited', retryAfterMs: 12_000 });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [500, 'server'],
    [503, 'server'],
    [418, 'http'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () => new Response('', { status }),
    });

    await expect(
      provider.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind, status });
  });

  it('maps invalid JSON to bad-response', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () => textResponse('not json'),
    });

    await expect(
      provider.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('maps malformed payloads to bad-response', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () => jsonResponse({ states: 'nope' }),
    });

    await expect(
      provider.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('maps transport failures to network', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(
      provider.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('does not call fetch when the signal is already aborted', async () => {
    let called = false;
    const provider = createOpenSkyProvider({
      fetchImpl: async () => {
        called = true;
        return jsonResponse(STATES_RESPONSE);
      },
    });

    const controller = new AbortController();
    controller.abort();

    await expect(provider.fetchFlights(BBOX, controller.signal)).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(called).toBe(false);
  });

  it('aborts an in-flight request', async () => {
    const provider = createOpenSkyProvider({ fetchImpl: neverAbortableFetch });
    const controller = new AbortController();

    const result = provider.fetchFlights(BBOX, controller.signal);
    const expectation = expect(result).rejects.toMatchObject({ kind: 'aborted' });
    controller.abort();
    await expectation;
  });

  it('times out stalled requests as network errors', async () => {
    const provider = createOpenSkyProvider({
      timeoutMs: 10,
      fetchImpl: neverAbortableFetch,
    });

    await expect(
      provider.fetchFlights(BBOX, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('error helpers', () => {
  it('recognises abort errors and provider kinds', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new ProviderError('aborted', 'stop'))).toBe(true);
    expect(isAbortError(new ProviderError('network', 'nope'))).toBe(false);
    expect(isProviderError(new ProviderError('rate-limited', 'later'), 'rate-limited')).toBe(true);
    expect(isProviderError(new Error('plain'))).toBe(false);
  });
});
