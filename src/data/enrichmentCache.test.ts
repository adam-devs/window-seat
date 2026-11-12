import { describe, expect, it, vi } from 'vitest';
import {
  ENRICHMENT_CACHE_LIMIT,
  ENRICHMENT_MISSING_TTL_MS,
  ENRICHMENT_STORAGE_KEY,
  ENRICHMENT_TTL_MS,
  isEnrichmentFresh,
  parseEnrichmentCache,
  pruneEnrichmentCache,
  readEnrichmentCache,
  serializeEnrichmentCache,
  writeEnrichmentCache,
  type EnrichmentCache,
} from './enrichmentCache';
import type { FlightEnrichment } from './flightEnrichment';

function entry(fetchedAt: number, status: 'ready' | 'missing' = 'ready'): FlightEnrichment {
  return {
    status,
    origin:
      status === 'ready'
        ? {
            city: 'London',
            airportName: 'Heathrow',
            iata: 'LHR',
            icao: 'EGLL',
            country: 'United Kingdom',
            countryCode: 'GB',
          }
        : null,
    aircraft:
      status === 'ready'
        ? {
            manufacturer: 'Airbus',
            type: 'A320',
            icaoType: 'A320',
            registration: 'G-TEST',
          }
        : null,
    airline:
      status === 'ready'
        ? {
            name: 'British Airways',
            icao: 'BAW',
            iata: 'BA',
            country: 'United Kingdom',
          }
        : null,
    fetchedAt,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } satisfies Storage;
}

describe('isEnrichmentFresh', () => {
  it('uses the shorter TTL for missing entries', () => {
    const now = 100_000_000;
    expect(isEnrichmentFresh(entry(now - 1_000), now)).toBe(true);
    expect(
      isEnrichmentFresh(entry(now - ENRICHMENT_TTL_MS + 1), now),
    ).toBe(true);
    expect(
      isEnrichmentFresh(entry(now - ENRICHMENT_TTL_MS), now),
    ).toBe(false);

    expect(
      isEnrichmentFresh(
        entry(now - ENRICHMENT_MISSING_TTL_MS + 1, 'missing'),
        now,
      ),
    ).toBe(true);
    expect(
      isEnrichmentFresh(
        entry(now - ENRICHMENT_MISSING_TTL_MS, 'missing'),
        now,
      ),
    ).toBe(false);
  });

  it('never treats loading or error entries as fresh', () => {
    const now = 100_000_000;
    expect(isEnrichmentFresh({ status: 'loading', origin: null, aircraft: null, airline: null, fetchedAt: now }, now)).toBe(false);
    expect(isEnrichmentFresh({ status: 'error', origin: null, aircraft: null, airline: null, fetchedAt: now }, now)).toBe(false);
  });
});

describe('pruneEnrichmentCache', () => {
  it('drops expired entries and keeps the newest entries up to the limit', () => {
    const now = 1_000_000_000;
    const cache: EnrichmentCache = {
      expired: entry(now - ENRICHMENT_TTL_MS),
      fresh: entry(now - 1),
    };
    expect(Object.keys(pruneEnrichmentCache(cache, now))).toEqual(['fresh']);

    const large: EnrichmentCache = {};
    for (let index = 0; index < ENRICHMENT_CACHE_LIMIT + 10; index += 1) {
      large[`key-${index}`] = entry(now - index * 1_000);
    }
    const pruned = pruneEnrichmentCache(large, now);
    expect(Object.keys(pruned)).toHaveLength(ENRICHMENT_CACHE_LIMIT);
    expect(pruned['key-0']).toBeTruthy();
    expect(pruned[`key-${ENRICHMENT_CACHE_LIMIT + 9}`]).toBeUndefined();
  });
});

describe('parseEnrichmentCache', () => {
  it('round-trips valid entries and skips invalid ones', () => {
    const raw = serializeEnrichmentCache({
      valid: entry(1_000),
      missing: entry(1_000, 'missing'),
    });
    const parsed = parseEnrichmentCache(raw, 2_000);
    expect(parsed.valid.origin?.city).toBe('London');
    expect(parsed.valid.airline?.name).toBe('British Airways');
    expect(parsed.missing.status).toBe('missing');

    const invalid = JSON.stringify({
      version: 2,
      entries: {
        broken: { status: 'ready', fetchedAt: 1_000 },
        wrong: { status: 'loading', fetchedAt: 1_000 },
      },
    });
    expect(parseEnrichmentCache(invalid, 2_000)).toEqual({});
  });

  it('returns an empty cache for corrupt, v1, or version-mismatched payloads', () => {
    expect(parseEnrichmentCache('not json')).toEqual({});
    expect(
      parseEnrichmentCache(
        JSON.stringify({
          version: 1,
          entries: {
            old: entry(1_000),
          },
        }),
        2_000,
      ),
    ).toEqual({});
    expect(
      parseEnrichmentCache(JSON.stringify({ version: 99, entries: {} })),
    ).toEqual({});
    expect(parseEnrichmentCache(null)).toEqual({});
  });
});

describe('read/writeEnrichmentCache', () => {
  it('reads and writes through storage', () => {
    const storage = memoryStorage();
    writeEnrichmentCache(storage, { one: entry(1_000) }, 2_000);
    expect(readEnrichmentCache(storage, 2_000).one.origin?.city).toBe('London');
  });

  it('degrades to memory when storage throws', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() =>
      writeEnrichmentCache(storage, { one: entry(1_000) }, 2_000),
    ).not.toThrow();
    expect(readEnrichmentCache(storage, 2_000)).toEqual({});
  });

  it('ignores storage read failures', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readEnrichmentCache(storage, 2_000)).toEqual({});
  });
});
