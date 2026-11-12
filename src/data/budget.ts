import { config } from '../config';
import type { BoundingBox } from '../types';
import { isRecord } from './normalize';
import { estimateCreditCost, usableDailyBudget } from './policy';
import type { ProviderId } from './types';

/**
 * Credit budget accounting.
 *
 * Usage is persisted per provider and local calendar day. The guard is
 * deliberately independent of React and of the request loop: the hook asks it
 * whether a request is allowed, then records successful responses so the next
 * cadence calculation has fresh numbers.
 *
 * OpenSky reports `x-rate-limit-remaining` on every response. That header is
 * authoritative for the provider's own quota, so it is used in two ways:
 *
 * - infer the day's effective allowance (`remaining + our recorded spend`) so
 *   an anonymous 400-credit quota is respected instead of assuming 4,000;
 * - keep `providerRemaining` for display and reconciliation.
 *
 * Effective allowance is only ever lowered from the configured budget, never
 * raised above it.
 */

export const BUDGET_STORAGE_KEY = 'window-seat:budget:v1';

export type BudgetMode = 'auto' | 'manual';

export interface BudgetUsage {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Credits recorded for this provider today. */
  spent: number;
  /** Successful requests recorded today. */
  requests: number;
  /** Last provider-reported remaining credits, when exposed. */
  providerRemaining: number | null;
  /** Allowance inferred from `providerRemaining + spent` (capped by config). */
  observedBudget: number | null;
  updatedAt: number;
}

export interface BudgetState {
  version: 1;
  providers: Partial<Record<ProviderId, BudgetUsage>>;
}

export interface BudgetStatus {
  providerId: ProviderId;
  day: string;
  /** Configured daily allowance (`config.dailyBudget` unless overridden). */
  configuredBudget: number;
  /** Effective allowance after reconciliation with provider headers. */
  dailyBudget: number;
  budgetPauseRatio: number;
  /** Share of the effective allowance available to auto-refresh. */
  usableBudget: number;
  spent: number;
  requests: number;
  providerRemaining: number | null;
  observedBudget: number | null;
  /** Credits left before the hard daily limit. */
  remaining: number;
  /** Credits left before auto-refresh pauses. */
  autoRemaining: number;
  /** True once spend reaches the auto-refresh pause threshold. */
  autoPaused: boolean;
  /** True when at least one more request fits in the hard budget. */
  manualAvailable: boolean;
  /** Epoch ms of the next local midnight (budget reset). */
  resetAt: number;
  msUntilReset: number;
  updatedAt: number;
}

export interface BudgetCheck {
  allowed: boolean;
  mode: BudgetMode;
  cost: number;
  /** `null` when allowed; otherwise why the request is blocked. */
  blockedBy: 'auto-pause' | 'exhausted' | null;
  status: BudgetStatus;
}

export interface BudgetRequestInput {
  /** Explicit credit cost. Takes precedence over `bbox`. */
  cost?: number;
  /** Used to estimate cost when `cost` is omitted. */
  bbox?: BoundingBox;
  /** Value of `x-rate-limit-remaining`, when the provider exposes it. */
  rateLimitRemaining?: number | null;
}

export interface BudgetGuardOptions {
  providerId?: ProviderId;
  /** Injectable for tests; defaults to `window.localStorage` when available. */
  storage?: Storage | null;
  now?: () => number;
  dailyBudget?: number;
  budgetPauseRatio?: number;
}

export interface BudgetGuard {
  readonly providerId: ProviderId;
  getStatus(): BudgetStatus;
  canRequest(input?: BudgetRequestInput & { mode?: BudgetMode }): BudgetCheck;
  /** Record one completed request, optionally reconciling the provider header. */
  recordSuccess(input?: BudgetRequestInput): BudgetStatus;
  /** Forget today's usage for this provider (debug / explicit reset). */
  reset(): BudgetStatus;
}

function getDefaultStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Local calendar day as `YYYY-MM-DD`. */
export function localDayKey(now: number = Date.now()): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Epoch ms of the next local midnight. Handles DST transitions. */
export function nextLocalMidnight(now: number = Date.now()): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function emptyState(): BudgetState {
  return { version: 1, providers: {} };
}

function nonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseUsage(value: unknown): BudgetUsage | null {
  if (!isRecord(value)) return null;

  const day = typeof value.day === 'string' ? value.day : null;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const spent = nonNegative(value.spent);
  const requests = nonNegative(value.requests);
  const updatedAt = nonNegative(value.updatedAt);
  if (spent === null || requests === null || updatedAt === null) return null;

  const providerRemaining =
    value.providerRemaining === null || value.providerRemaining === undefined
      ? null
      : nonNegative(value.providerRemaining);
  const observedBudget =
    value.observedBudget === null || value.observedBudget === undefined
      ? null
      : nonNegative(value.observedBudget);

  return {
    day,
    spent,
    requests: Math.floor(requests),
    providerRemaining,
    observedBudget,
    updatedAt,
  };
}

/** Validate a parsed budget state; anything malformed is discarded. */
export function parseBudgetState(value: unknown): BudgetState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.providers)) {
    return emptyState();
  }

  const providers: Partial<Record<ProviderId, BudgetUsage>> = {};
  for (const [id, raw] of Object.entries(value.providers)) {
    if (id !== config.providerId) continue;
    const usage = parseUsage(raw);
    if (usage) providers[id as ProviderId] = usage;
  }

  return { version: 1, providers };
}

export function parseBudgetStateJson(raw: string | null): BudgetState {
  if (!raw) return emptyState();
  try {
    return parseBudgetState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function loadBudgetState(storage: Storage | null = getDefaultStorage()): BudgetState {
  if (!storage) return emptyState();
  try {
    return parseBudgetStateJson(storage.getItem(BUDGET_STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

export function saveBudgetState(
  state: BudgetState,
  storage: Storage | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function freshUsage(day: string, now: number): BudgetUsage {
  return {
    day,
    spent: 0,
    requests: 0,
    providerRemaining: null,
    observedBudget: null,
    updatedAt: now,
  };
}

/** Usage for today, resetting the entry when the calendar day changed. */
function usageForDay(state: BudgetState, providerId: ProviderId, now: number): BudgetUsage {
  const day = localDayKey(now);
  const existing = state.providers[providerId];
  if (!existing || existing.day !== day) return freshUsage(day, now);
  return existing;
}

function normalizeCost(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

function costFromInput(input: BudgetRequestInput): number {
  if (input.cost !== undefined) return normalizeCost(input.cost);
  if (input.bbox) return estimateCreditCost(input.bbox);
  return 1;
}

function normalizeOptions(options: BudgetGuardOptions) {
  const providerId = options.providerId ?? config.providerId;
  const dailyBudget =
    typeof options.dailyBudget === 'number' &&
    Number.isFinite(options.dailyBudget) &&
    options.dailyBudget >= 0
      ? options.dailyBudget
      : config.dailyBudget;
  const budgetPauseRatio =
    typeof options.budgetPauseRatio === 'number' &&
    Number.isFinite(options.budgetPauseRatio) &&
    options.budgetPauseRatio >= 0
      ? Math.min(1, options.budgetPauseRatio)
      : config.budgetPauseRatio;

  return { providerId, dailyBudget, budgetPauseRatio };
}

function effectiveBudget(
  configuredBudget: number,
  observedBudget: number | null,
): number {
  if (observedBudget === null) return configuredBudget;
  return Math.min(configuredBudget, Math.max(0, observedBudget));
}

function buildStatus(
  providerId: ProviderId,
  usage: BudgetUsage,
  configuredBudget: number,
  budgetPauseRatio: number,
  now: number,
): BudgetStatus {
  const dailyBudget = effectiveBudget(configuredBudget, usage.observedBudget);
  const spent = Math.min(dailyBudget, Math.max(0, usage.spent));
  const usableBudget = usableDailyBudget(dailyBudget, budgetPauseRatio);
  const remaining = Math.max(0, dailyBudget - spent);
  const autoRemaining = Math.max(0, usableBudget - spent);
  const resetAt = nextLocalMidnight(now);

  return {
    providerId,
    day: usage.day,
    configuredBudget,
    dailyBudget,
    budgetPauseRatio,
    usableBudget,
    spent,
    requests: usage.requests,
    providerRemaining: usage.providerRemaining,
    observedBudget: usage.observedBudget,
    remaining,
    autoRemaining,
    autoPaused: spent >= usableBudget,
    manualAvailable: remaining >= 1,
    resetAt,
    msUntilReset: Math.max(0, resetAt - now),
    updatedAt: usage.updatedAt,
  };
}

/**
 * Create a budget guard backed by `localStorage`.
 *
 * Each operation re-reads storage, so multiple tabs do not overwrite each
 * other's spend with a stale snapshot. Persistence failures fall back to an
 * instance-local copy for the rest of the session.
 */
export function createBudgetGuard(options: BudgetGuardOptions = {}): BudgetGuard {
  const { providerId, dailyBudget, budgetPauseRatio } = normalizeOptions(options);
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  let memoryState: BudgetState | null = null;
  let storageUnavailable = false;

  function readState(): BudgetState {
    if (storage && !storageUnavailable) return loadBudgetState(storage);
    return memoryState ?? emptyState();
  }

  function writeState(state: BudgetState): void {
    memoryState = state;
    if (storage && !storageUnavailable) {
      storageUnavailable = !saveBudgetState(state, storage);
    }
  }

  function currentStatus(): BudgetStatus {
    const state = readState();
    const usage = usageForDay(state, providerId, now());
    return buildStatus(providerId, usage, dailyBudget, budgetPauseRatio, now());
  }

  return {
    providerId,

    getStatus: currentStatus,

    canRequest(input = {}) {
      const status = currentStatus();
      const mode = input.mode ?? 'auto';
      const cost = costFromInput(input);

      let blockedBy: BudgetCheck['blockedBy'] = null;
      if (status.spent + cost > status.dailyBudget) {
        blockedBy = 'exhausted';
      } else if (mode === 'auto' && status.spent + cost > status.usableBudget) {
        blockedBy = 'auto-pause';
      }

      return {
        allowed: blockedBy === null,
        mode,
        cost,
        blockedBy,
        status,
      };
    },

    recordSuccess(input = {}) {
      const timestamp = now();
      const state = readState();
      const existing = usageForDay(state, providerId, timestamp);

      const cost = costFromInput(input);
      const nextSpent = Math.max(0, existing.spent + cost);

      let providerRemaining = existing.providerRemaining;
      let observedBudget = existing.observedBudget;

      if (
        typeof input.rateLimitRemaining === 'number' &&
        Number.isFinite(input.rateLimitRemaining) &&
        input.rateLimitRemaining >= 0
      ) {
        providerRemaining = input.rateLimitRemaining;
        // The header is post-request: remaining + our spend approximates the
        // allowance for the day. Cap at the configured budget.
        const inferred = providerRemaining + nextSpent;
        observedBudget = Math.min(dailyBudget, Math.max(0, inferred));
      }

      const cappedBudget = effectiveBudget(dailyBudget, observedBudget);
      const usage: BudgetUsage = {
        ...existing,
        spent: Math.min(cappedBudget, nextSpent),
        requests: existing.requests + 1,
        providerRemaining,
        observedBudget,
        updatedAt: timestamp,
      };

      const nextState: BudgetState = {
        version: 1,
        providers: { ...state.providers, [providerId]: usage },
      };
      writeState(nextState);

      return buildStatus(providerId, usage, dailyBudget, budgetPauseRatio, timestamp);
    },

    reset() {
      const timestamp = now();
      const state = readState();
      const usage = freshUsage(localDayKey(timestamp), timestamp);
      writeState({
        version: 1,
        providers: { ...state.providers, [providerId]: usage },
      });
      return buildStatus(providerId, usage, dailyBudget, budgetPauseRatio, timestamp);
    },
  };
}

/** Convenience for UI copy: ms until the local-day budget resets. */
export function budgetDayWindowMs(now: number = Date.now()): number {
  return Math.max(0, nextLocalMidnight(now) - now);
}
