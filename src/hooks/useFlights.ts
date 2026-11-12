import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import type { BoundingBox } from '../types';
import { config } from '../config';
import { clampRefreshMs } from '../settings';
import type {
  Aircraft,
  FlightProvider,
  ProviderId,
  Snapshot,
} from '../data/types';
import { getProvider } from '../data/providers';
import { isAbortError, isProviderError } from '../data/errors';
import {
  deriveFlightStatus,
  isStaleData,
  type FlightStatus,
} from '../data/flightStatus';
import {
  computeCadence,
  estimateCreditCost,
  type Cadence,
} from '../data/policy';
import {
  createBackoff,
  type BackoffController,
  type BackoffDecision,
} from '../data/backoff';
import {
  createBudgetGuard,
  type BudgetGuard,
  type BudgetStatus,
} from '../data/budget';
import {
  createLastGoodState,
  lastGoodReducer,
  selectCurrent,
} from '../data/lastGood';
import { createPollScheduler } from '../data/pollScheduler';
import {
  createRequestCoordinator,
  type RequestCoordinator,
} from '../data/requestCoordinator';

/** How often data age is recomputed while a snapshot is on screen. */
const STATUS_TICK_MS = 5_000;

/**
 * Result of a manual refresh attempt. `started` means a new request began;
 * `in-flight` means the click joined the request already in progress.
 */
export type RefreshOutcome =
  | 'started'
  | 'in-flight'
  | 'throttled'
  | 'budget-exhausted'
  | 'no-area'
  | 'unavailable';

export interface UseFlightsOptions {
  /** User's preferred auto-refresh interval; clamped to the supported range. */
  autoRefreshMs?: number;
  /**
   * Optional key for last-good data and request identity.
   *
   * Use this when the selection can change without changing the provider bbox
   * (for example, a View bearing change that keeps the same enclosing box). A
   * new key clears the previous snapshot and starts a new request, while
   * failures for the same key keep the last-good filtered data.
   */
  selectionKey?: string | null;
}

export interface UseFlightsResult {
  status: FlightStatus;
  flights: Aircraft[];
  /** True while any request is in flight (first load or refresh). */
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful response for the active area. */
  lastSuccessAt: number | null;
  /** Age of the current snapshot in ms, or null when there is no data. */
  dataAgeMs: number | null;
  /** Epoch ms when the next automatic retry is due, or null. */
  nextRetryAt: number | null;
  /** True when the current snapshot is older than `config.staleAfterMs`. */
  isStale: boolean;
  /** Effective auto-refresh cadence for the active area, or null. */
  cadence: Cadence | null;
  providerId: ProviderId;
  providerName: string;
  /** Current local-day credit usage and limits. */
  budget: BudgetStatus;
  /** Convenience `Date` used by the existing panel; same as `lastSuccessAt`. */
  lastUpdated: Date | null;
  /** Request an immediate refresh; safe to call repeatedly. */
  refresh: () => RefreshOutcome;
}

function bboxKey(bbox: BoundingBox): string {
  return `${bbox.lamin},${bbox.lomin},${bbox.lamax},${bbox.lomax}`;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useFlights(
  bbox: BoundingBox | null,
  options: UseFlightsOptions = {},
): UseFlightsResult {
  const bboxAreaKey = bbox ? bboxKey(bbox) : null;
  const suppliedKey = options.selectionKey?.trim()
    ? options.selectionKey
    : null;
  const dataKey = bbox ? (suppliedKey ?? bboxAreaKey) : null;
  const activeKey = dataKey;
  const userIntervalMs = clampRefreshMs(
    options.autoRefreshMs ?? config.defaultRefreshMs,
  );

  const [dataState, dispatch] = useReducer(
    lastGoodReducer<Snapshot>,
    activeKey,
    (key) => createLastGoodState<Snapshot>(key),
  );
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Epoch ms of the next automatic retry, when a request is backoff-scheduled. */
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);

  const bboxRef = useRef<BoundingBox | null>(bbox);
  bboxRef.current = bbox;
  const dataKeyRef = useRef<string | null>(activeKey);
  dataKeyRef.current = activeKey;

  /** Selection the current backoff sequence belongs to. */
  const areaKeyRef = useRef<string | null>(activeKey);

  /** Starts an immediate polling cycle from the active effect. */
  const triggerRef = useRef<(() => void) | null>(null);
  /** Reschedules the pending poll when the user interval changes. */
  const rescheduleRef = useRef<(() => void) | null>(null);
  /** Latest interval, readable from callbacks without re-creating the loop. */
  const userIntervalRef = useRef(userIntervalMs);
  userIntervalRef.current = userIntervalMs;
  /** Last manual refresh that actually started a request. */
  const lastManualRefreshAtRef = useRef<number | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const providerRef = useRef<FlightProvider | null>(null);
  if (!providerRef.current) providerRef.current = getProvider();

  const budgetRef = useRef<BudgetGuard | null>(null);
  if (!budgetRef.current) {
    budgetRef.current = createBudgetGuard({ providerId: providerRef.current.id });
  }
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus>(() =>
    budgetRef.current!.getStatus(),
  );

  const coordinatorRef = useRef<RequestCoordinator<Snapshot> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createRequestCoordinator<Snapshot>();
  }

  const backoffRef = useRef<BackoffController | null>(null);
  if (!backoffRef.current) {
    backoffRef.current = createBackoff();
  }

  /** Cadence for the active area using the freshest persisted budget. */
  const getCadence = useCallback((box: BoundingBox): Cadence => {
    const budget = budgetRef.current!.getStatus();
    return computeCadence({
      userIntervalMs: userIntervalRef.current,
      providerMinIntervalMs: providerRef.current!.minIntervalMs,
      costPerRequest: estimateCreditCost(box),
      spentToday: budget.spent,
      dailyBudget: budget.dailyBudget,
      budgetPauseRatio: budget.budgetPauseRatio,
      msUntilReset: budget.msUntilReset,
    });
  }, []);

  // Last-good data and errors are keyed to the active area. The selector hides
  // the previous area's data during the render before the effect switches keys.
  const current = selectCurrent(dataState, activeKey);
  const currentSnapshot = current.data;
  const currentError = current.error;
  // A retry scheduled for the previous area must not leak into the new one
  // during the render before the effect resets the store.
  const currentNextRetryAt = dataState.key === activeKey ? nextRetryAt : null;

  const load = useCallback(
    async (
      box: BoundingBox,
      key: string,
    ): Promise<BackoffDecision | null> => {
      const coordinator = coordinatorRef.current!;
      const provider = providerRef.current!;
      const backoff = backoffRef.current!;
      const budget = budgetRef.current!;

      // A trigger that fired just before a selection change/unmount must not
      // spend a request on the old selection.
      if (!mountedRef.current || !bboxRef.current) return null;
      if (dataKeyRef.current !== key) return null;

      setLoading(true);
      // Keep the previous snapshot; only clear the failure that prompted this try.
      dispatch({ type: 'request-start', key });
      setNextRetryAt(null);

      try {
        const snapshot = await coordinator.run({
          key,
          // Record spend exactly once per network request. Same-key callers join
          // the active task, so the accounting cannot double-count a refresh.
          task: async (signal) => {
            const result = await provider.fetchFlights(box, signal);
            budget.recordSuccess({
              cost: result.cost,
              bbox: box,
              rateLimitRemaining: result.rateLimitRemaining,
            });
            return result;
          },
        });

        // Ignore a response that belonged to a previous selection or an
        // unmounted hook.
        if (!mountedRef.current || !bboxRef.current) return null;
        if (dataKeyRef.current !== key) return null;

        backoff.recordSuccess();
        dispatch({ type: 'request-success', key, data: snapshot });
        setBudgetStatus(budget.getStatus());
        setNow(Date.now());
        return null;
      } catch (e) {
        // Area changes and unmounts abort the request; do not surface those.
        if (isAbortError(e)) return null;
        if (!mountedRef.current || !bboxRef.current) return null;
        if (dataKeyRef.current !== key) return null;

        // A retryable failure schedules the next attempt with exponential
        // backoff; non-retryable failures fall back to the normal cadence.
        const decision = backoff.recordFailure(e);
        setNextRetryAt(decision.nextRetryAt);
        dispatch({
          type: 'request-failure',
          key,
          error: e instanceof Error ? e : new Error('Unknown error'),
        });
        setNow(Date.now());
        return decision;
      } finally {
        // A superseded request settles before its replacement starts, so only the
        // last one clears the loading state.
        if (mountedRef.current && coordinator.isIdle) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const coordinator = coordinatorRef.current!;
    const doc = typeof document === 'undefined' ? null : document;

    if (!bbox || !dataKey) {
      coordinator.cancel();
      triggerRef.current = null;
      rescheduleRef.current = null;
      dispatch({ type: 'select-area', key: null });
      setLoading(false);
      areaKeyRef.current = null;
      lastManualRefreshAtRef.current = null;
      backoffRef.current!.reset();
      setNextRetryAt(null);
      return;
    }

    const box = bbox;
    const key = dataKey;

    // A new area starts with a fresh retry sequence. Re-renders and manual
    // refreshes for the same area keep the existing attempt count.
    if (areaKeyRef.current !== key) {
      areaKeyRef.current = key;
      lastManualRefreshAtRef.current = null;
      backoffRef.current!.reset();
      setNextRetryAt(null);
    }

    // A new area starts fresh; last-good data only applies within the same area.
    dispatch({ type: 'select-area', key });
    setLoading(false);

    let cancelled = false;
    const scheduler = createPollScheduler(() => {
      void cycle();
    });

    function schedule(delayMs: number): void {
      // Replace any pending poll first, even when the tab is hidden.
      scheduler.clear();
      // Hidden tabs do not poll. The next visible transition refreshes once.
      if (cancelled || isDocumentHidden()) return;
      scheduler.schedule(delayMs);
    }

    async function cycle(mode: 'auto' | 'manual' = 'auto'): Promise<void> {
      if (cancelled) return;

      const budget = budgetRef.current!;
      const check = budget.canRequest({ bbox: box, mode });
      setBudgetStatus(check.status);

      if (!check.allowed) {
        // Auto-refresh has used its share (or the hard limit is reached).
        // Wait for the daily reset instead of waking up every 30 s.
        const waitMs = Math.max(0, check.status.resetAt - Date.now());
        setNextRetryAt(check.status.resetAt);
        schedule(waitMs);
        return;
      }

      const decision = await load(box, key);
      if (cancelled) return;

      const cadence = getCadence(box);
      if (cadence.paused) {
        const status = budget.getStatus();
        setBudgetStatus(status);
        setNextRetryAt(status.resetAt);
        schedule(Math.max(0, status.resetAt - Date.now()));
        return;
      }

      const retryDelay =
        decision?.retry && decision.delayMs !== null ? decision.delayMs : null;
      schedule(retryDelay ?? cadence.intervalMs);
    }

    // Manual refresh clears the pending timer and polls now. It does not restart
    // this effect, so an in-flight request remains single-flight.
    const trigger = (): void => {
      scheduler.clear();
      void cycle('manual');
    };
    triggerRef.current = trigger;

    // Apply a settings change to the pending poll without aborting a request
    // that is already in flight.
    const reschedule = (): void => {
      if (cancelled || isDocumentHidden()) return;
      if (!coordinator.isIdle) return;

      const cadence = getCadence(box);
      if (cadence.paused) {
        const status = budgetRef.current!.getStatus();
        setBudgetStatus(status);
        setNextRetryAt(status.resetAt);
        schedule(Math.max(0, status.resetAt - Date.now()));
        return;
      }
      schedule(cadence.intervalMs);
    };
    rescheduleRef.current = reschedule;

    function handleVisibilityChange(): void {
      if (isDocumentHidden()) {
        scheduler.clear();
        // The scheduled retry is no longer pending once the timer is gone.
        setNextRetryAt(null);
        return;
      }

      // Back from a hidden tab: refresh immediately, then resume the cadence.
      scheduler.clear();
      void cycle();
    }

    doc?.addEventListener('visibilitychange', handleVisibilityChange);

    // Do not spend a request while the tab starts out hidden.
    if (!isDocumentHidden()) void cycle();

    return () => {
      // Abort the in-flight request and drop any pending timer on area change
      // or unmount.
      cancelled = true;
      scheduler.dispose();
      if (triggerRef.current === trigger) triggerRef.current = null;
      if (rescheduleRef.current === reschedule) rescheduleRef.current = null;
      doc?.removeEventListener('visibilitychange', handleVisibilityChange);
      coordinator.cancel();
    };
  }, [bbox, dataKey, load, getCadence]);

  // Apply interval changes to the pending poll; the active request is left
  // alone and will schedule using the new cadence when it settles.
  useEffect(() => {
    rescheduleRef.current?.();
  }, [userIntervalMs]);

  // Refresh data age while a snapshot is visible so `stale` appears on time.
  useEffect(() => {
    if (!currentSnapshot) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => clearInterval(id);
  }, [currentSnapshot]);

  const dataAgeMs = currentSnapshot
    ? Math.max(0, now - currentSnapshot.fetchedAt)
    : null;

  const errorKind =
    currentError && isProviderError(currentError) ? currentError.kind : null;

  const errorMessage =
    currentError === null
      ? null
      : currentError instanceof Error
        ? currentError.message
        : String(currentError);

  const status = deriveFlightStatus({
    hasArea: bbox !== null,
    hasData: currentSnapshot !== null,
    isLoading: loading && bbox !== null,
    hasError: currentError !== null,
    errorKind,
    dataAgeMs,
    staleAfterMs: config.staleAfterMs,
  });

  const lastSuccessAt = currentSnapshot?.fetchedAt ?? null;
  const isStale = isStaleData(dataAgeMs, config.staleAfterMs);
  const provider = providerRef.current!;

  const cadence = bbox
    ? computeCadence({
        userIntervalMs,
        providerMinIntervalMs: provider.minIntervalMs,
        costPerRequest: estimateCreditCost(bbox),
        spentToday: budgetStatus.spent,
        dailyBudget: budgetStatus.dailyBudget,
        budgetPauseRatio: budgetStatus.budgetPauseRatio,
        msUntilReset: budgetStatus.msUntilReset,
      })
    : null;

  const refresh = useCallback((): RefreshOutcome => {
    if (!mountedRef.current) return 'unavailable';
    if (!bbox || !activeKey) return 'no-area';

    const coordinator = coordinatorRef.current!;
    const key = activeKey;

    // Single-flight: a second click joins the request already in progress.
    if (coordinator.isRunning && coordinator.activeKey === key) {
      return 'in-flight';
    }

    const nowMs = Date.now();
    const lastManual = lastManualRefreshAtRef.current;
    if (
      lastManual !== null &&
      nowMs - lastManual < config.minManualRefreshMs
    ) {
      return 'throttled';
    }

    const budget = budgetRef.current!;
    const check = budget.canRequest({ mode: 'manual', bbox });
    // Keep the displayed usage accurate even when the request is blocked.
    setBudgetStatus(check.status);
    if (!check.allowed) return 'budget-exhausted';

    const trigger = triggerRef.current;
    if (!trigger) return 'unavailable';

    lastManualRefreshAtRef.current = nowMs;
    trigger();
    return 'started';
  }, [bbox, activeKey]);

  return {
    status,
    flights: currentSnapshot?.aircraft ?? [],
    loading,
    error: errorMessage,
    lastSuccessAt,
    dataAgeMs,
    nextRetryAt: currentNextRetryAt,
    isStale,
    cadence,
    providerId: provider.id,
    providerName: provider.name,
    budget: budgetStatus,
    lastUpdated: lastSuccessAt === null ? null : new Date(lastSuccessAt),
    refresh,
  };
}
