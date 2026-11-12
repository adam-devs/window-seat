import { useCallback, useEffect, useRef, useState } from 'react';
import {
  enrichmentKey,
  idleEnrichment,
  parseFlightEnrichment,
  type FlightEnrichment,
} from '../data/flightEnrichment';
import {
  isEnrichmentFresh,
  readEnrichmentCache,
  writeEnrichmentCache,
  type EnrichmentCache,
} from '../data/enrichmentCache';

const MAX_CONCURRENT = 2;
const REQUEST_TIMEOUT_MS = 8_000;
const ERROR_RETRY_MS = 5 * 60_000;

interface EnrichmentTask {
  key: string;
  icao24: string;
  callsign: string | null;
}

export interface FlightEnrichmentApi {
  getEnrichment: (
    icao24: string,
    callsign: string | null,
  ) => FlightEnrichment;
  requestEnrichment: (
    icao24: string,
    callsign: string | null,
  ) => void;
}

/**
 * adsbdb lookup through the local Vite proxy.
 *
 * The combined endpoint returns aircraft metadata and the callsign-based route
 * in one request. Any non-404 failure is transient; unknown records are cached
 * for a shorter period so scrolling does not repeatedly ask for them.
 */
async function fetchEnrichment(
  task: EnrichmentTask,
  signal: AbortSignal,
): Promise<FlightEnrichment | null> {
  const path = task.callsign
    ? `/adsbdb/v0/aircraft/${encodeURIComponent(task.icao24)}?callsign=${encodeURIComponent(task.callsign)}`
    : `/adsbdb/v0/aircraft/${encodeURIComponent(task.icao24)}`;

  const response = await fetch(path, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`adsbdb request failed (${response.status})`);
  }
  return parseFlightEnrichment(await response.json());
}

function readStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useFlightEnrichment(): FlightEnrichmentApi {
  const storageRef = useRef<Storage | null>(readStorage());
  const [records, setRecords] = useState<EnrichmentCache>(() =>
    readEnrichmentCache(storageRef.current),
  );
  const recordsRef = useRef(records);
  recordsRef.current = records;

  const queueRef = useRef<EnrichmentTask[]>([]);
  const queuedRef = useRef(new Set<string>());
  const activeRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  const mountedRef = useRef(true);
  const pumpRef = useRef<() => void>(() => {});

  const commit = useCallback((key: string, record: FlightEnrichment) => {
    const next = { ...recordsRef.current, [key]: record };
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const persist = useCallback(() => {
    writeEnrichmentCache(storageRef.current, recordsRef.current);
  }, []);

  const pump = useCallback(() => {
    while (
      activeRef.current < MAX_CONCURRENT &&
      queueRef.current.length > 0
    ) {
      const task = queueRef.current.shift()!;
      queuedRef.current.delete(task.key);

      const existing = recordsRef.current[task.key];
      if (existing && isEnrichmentFresh(existing)) {
        continue;
      }

      activeRef.current += 1;
      const controller = new AbortController();
      controllersRef.current.add(controller);
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      void fetchEnrichment(task, controller.signal)
        .then((result) => {
          if (!mountedRef.current) return;
          commit(
            task.key,
            result ?? {
              status: 'missing',
              origin: null,
              aircraft: null,
              airline: null,
              fetchedAt: Date.now(),
            },
          );
          persist();
        })
        .catch(() => {
          if (!mountedRef.current) return;
          const now = Date.now();
          commit(task.key, {
            status: 'error',
            origin: existing?.origin ?? null,
            aircraft: existing?.aircraft ?? null,
            airline: existing?.airline ?? null,
            fetchedAt: existing?.fetchedAt ?? 0,
            retryAt: now + ERROR_RETRY_MS,
          });
        })
        .finally(() => {
          clearTimeout(timeout);
          controllersRef.current.delete(controller);
          activeRef.current = Math.max(0, activeRef.current - 1);
          if (mountedRef.current) pumpRef.current();
        });
    }
  }, [commit, persist]);

  pumpRef.current = pump;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      queueRef.current = [];
      queuedRef.current.clear();
    };
  }, []);

  const requestEnrichment = useCallback(
    (icao24: string, callsign: string | null) => {
      const normalizedCallsign = callsign?.trim() || null;
      const key = enrichmentKey(icao24, normalizedCallsign);
      const now = Date.now();
      const existing = recordsRef.current[key];

      if (existing) {
        if (existing.status === 'loading') return;
        if (isEnrichmentFresh(existing, now)) return;
        if (
          existing.status === 'error' &&
          (existing.retryAt ?? 0) > now
        ) {
          return;
        }
      }
      if (queuedRef.current.has(key)) return;

      queuedRef.current.add(key);
      queueRef.current.push({
        key,
        icao24: icao24.trim().toLowerCase(),
        callsign: normalizedCallsign,
      });
      commit(key, {
        status: 'loading',
        origin: existing?.origin ?? null,
        aircraft: existing?.aircraft ?? null,
        airline: existing?.airline ?? null,
        fetchedAt: existing?.fetchedAt ?? 0,
      });
      pumpRef.current();
    },
    [commit],
  );

  const getEnrichment = useCallback(
    (icao24: string, callsign: string | null) =>
      records[enrichmentKey(icao24, callsign)] ?? idleEnrichment(),
    [records],
  );

  return { getEnrichment, requestEnrichment };
}
