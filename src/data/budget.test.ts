import { describe, expect, it } from 'vitest';
import {
  BUDGET_STORAGE_KEY,
  budgetDayWindowMs,
  createBudgetGuard,
  localDayKey,
  nextLocalMidnight,
  parseBudgetState,
  parseBudgetStateJson,
} from './budget';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));

  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

/** Local noon, so day-boundary tests do not depend on the CI time zone. */
const NOON = new Date(2026, 10, 12, 12, 0, 0).getTime();

function createGuard(
  overrides: Partial<Parameters<typeof createBudgetGuard>[0]> = {},
  storage = createMemoryStorage(),
) {
  let now = NOON;
  const guard = createBudgetGuard({
    storage,
    now: () => now,
    dailyBudget: 4_000,
    budgetPauseRatio: 0.9,
    ...overrides,
  });

  return {
    guard,
    storage,
    setNow(value: number) {
      now = value;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('day helpers', () => {
  it('formats the local calendar day', () => {
    expect(localDayKey(NOON)).toBe('2026-11-12');
  });

  it('finds the next local midnight', () => {
    expect(nextLocalMidnight(NOON)).toBe(new Date(2026, 10, 13).getTime());
  });

  it('exposes the ms remaining in the local day', () => {
    const late = new Date(2026, 10, 12, 23, 0, 0).getTime();
    expect(budgetDayWindowMs(late)).toBe(3_600_000);
  });
});

describe('parseBudgetState', () => {
  it.each([
    ['null', null],
    ['wrong version', { version: 2, providers: {} }],
    ['missing providers', { version: 1 }],
    ['array', []],
    ['primitive', 'nope'],
  ])('discards %s', (_label, value) => {
    expect(parseBudgetState(value)).toEqual({ version: 1, providers: {} });
  });

  it('discards malformed provider entries', () => {
    const state = parseBudgetState({
      version: 1,
      providers: {
        opensky: { day: 'not-a-day', spent: 1, requests: 1, updatedAt: 1 },
        other: { day: '2026-11-12', spent: 1, requests: 1, updatedAt: 1 },
      },
    });

    expect(state.providers).toEqual({});
  });

  it('keeps valid usage and nullish provider fields', () => {
    const state = parseBudgetState({
      version: 1,
      providers: {
        opensky: {
          day: '2026-11-12',
          spent: 12,
          requests: 3,
          providerRemaining: 3988,
          observedBudget: 4000,
          updatedAt: NOON,
        },
      },
    });

    expect(state.providers.opensky).toMatchObject({
      day: '2026-11-12',
      spent: 12,
      requests: 3,
      providerRemaining: 3988,
      observedBudget: 4000,
    });
  });

  it('returns an empty state for corrupt JSON', () => {
    expect(parseBudgetStateJson('{not json')).toEqual({ version: 1, providers: {} });
    expect(parseBudgetStateJson(null)).toEqual({ version: 1, providers: {} });
  });
});

describe('budget guard', () => {
  it('starts with a full budget and exposes the reset time', () => {
    const { guard } = createGuard();
    const status = guard.getStatus();

    expect(status.spent).toBe(0);
    expect(status.requests).toBe(0);
    expect(status.dailyBudget).toBe(4_000);
    expect(status.usableBudget).toBe(3_600);
    expect(status.remaining).toBe(4_000);
    expect(status.autoRemaining).toBe(3_600);
    expect(status.autoPaused).toBe(false);
    expect(status.manualAvailable).toBe(true);
    expect(status.day).toBe('2026-11-12');
    expect(status.resetAt).toBe(nextLocalMidnight(NOON));
    expect(status.msUntilReset).toBe(nextLocalMidnight(NOON) - NOON);
  });

  it('records a request and persists it across guard instances', () => {
    const storage = createMemoryStorage();
    const first = createGuard({}, storage);

    const status = first.guard.recordSuccess({ cost: 1 });

    expect(status.spent).toBe(1);
    expect(status.requests).toBe(1);
    expect(status.remaining).toBe(3_999);

    const second = createGuard({}, storage);
    expect(second.guard.getStatus()).toMatchObject({ spent: 1, requests: 1 });
    expect(storage.getItem(BUDGET_STORAGE_KEY)).toBeTruthy();
  });

  it('estimates the cost from the bounding box', () => {
    const { guard } = createGuard();

    // 20° × 20° = 400 sq°, OpenSky's 3-credit bucket.
    const status = guard.recordSuccess({
      bbox: { lamin: 0, lomin: 0, lamax: 20, lomax: 20 },
    });

    expect(status.spent).toBe(3);
    expect(status.requests).toBe(1);
  });

  it('prefers an explicit cost over the bounding box estimate', () => {
    const { guard } = createGuard();
    const status = guard.recordSuccess({
      cost: 1,
      bbox: { lamin: 0, lomin: 0, lamax: 20, lomax: 20 },
    });

    expect(status.spent).toBe(1);
  });

  it('pauses auto-refresh at the 90% threshold but allows manual refresh', () => {
    const { guard } = createGuard({ dailyBudget: 10 });

    guard.recordSuccess({ cost: 9 });
    const status = guard.getStatus();

    expect(status.autoPaused).toBe(true);
    expect(status.usableBudget).toBe(9);
    expect(status.manualAvailable).toBe(true);

    expect(guard.canRequest({ mode: 'auto', cost: 1 })).toMatchObject({
      allowed: false,
      blockedBy: 'auto-pause',
    });
    expect(guard.canRequest({ mode: 'manual', cost: 1 })).toMatchObject({
      allowed: true,
      blockedBy: null,
    });
  });

  it('blocks manual refresh once the hard budget is spent', () => {
    const { guard } = createGuard({ dailyBudget: 10 });

    guard.recordSuccess({ cost: 10 });
    const status = guard.getStatus();

    expect(status.remaining).toBe(0);
    expect(status.manualAvailable).toBe(false);
    expect(guard.canRequest({ mode: 'manual', cost: 1 })).toMatchObject({
      allowed: false,
      blockedBy: 'exhausted',
    });
  });

  it('accounts for the cost of the next request, not just the threshold', () => {
    const { guard } = createGuard({ dailyBudget: 10 });

    guard.recordSuccess({ cost: 8 });

    expect(guard.canRequest({ mode: 'auto', cost: 1 }).allowed).toBe(true);
    expect(guard.canRequest({ mode: 'auto', cost: 2 })).toMatchObject({
      allowed: false,
      blockedBy: 'auto-pause',
    });
    expect(guard.canRequest({ mode: 'auto', cost: 3 })).toMatchObject({
      allowed: false,
      blockedBy: 'exhausted',
    });
  });

  it('reconciles the provider header into the daily allowance', () => {
    const { guard } = createGuard();

    const first = guard.recordSuccess({ cost: 1, rateLimitRemaining: 3_999 });
    expect(first.providerRemaining).toBe(3_999);
    expect(first.observedBudget).toBe(4_000);
    expect(first.dailyBudget).toBe(4_000);
    expect(first.spent).toBe(1);

    // A second response shows another client consumed 1,000 credits.
    const second = guard.recordSuccess({ cost: 1, rateLimitRemaining: 2_999 });
    expect(second.providerRemaining).toBe(2_999);
    expect(second.observedBudget).toBe(3_001);
    expect(second.dailyBudget).toBe(3_001);
    expect(second.spent).toBe(2);
    expect(second.remaining).toBe(2_999);
  });

  it('respects an anonymous 400-credit allowance from the header', () => {
    const { guard } = createGuard();

    const status = guard.recordSuccess({ cost: 1, rateLimitRemaining: 399 });

    expect(status.dailyBudget).toBe(400);
    expect(status.usableBudget).toBe(360);
    expect(status.remaining).toBe(399);
    expect(status.observedBudget).toBe(400);
  });

  it('never infers an allowance above the configured budget', () => {
    const { guard } = createGuard({ dailyBudget: 100 });

    const status = guard.recordSuccess({ cost: 1, rateLimitRemaining: 5_000 });

    expect(status.dailyBudget).toBe(100);
    expect(status.observedBudget).toBe(100);
  });

  it('honours a provider-reported exhaustion even when local spend is low', () => {
    const { guard } = createGuard({ dailyBudget: 4_000 });

    const status = guard.recordSuccess({ cost: 1, rateLimitRemaining: 0 });

    expect(status.dailyBudget).toBe(1);
    expect(status.remaining).toBe(0);
    expect(status.manualAvailable).toBe(false);
    expect(guard.canRequest({ mode: 'manual', cost: 1 })).toMatchObject({
      allowed: false,
      blockedBy: 'exhausted',
    });
  });

  it('resets counters on a new local day', () => {
    const { guard, setNow } = createGuard();

    guard.recordSuccess({ cost: 1, rateLimitRemaining: 399 });
    expect(guard.getStatus()).toMatchObject({
      spent: 1,
      dailyBudget: 400,
      observedBudget: 400,
      providerRemaining: 399,
    });

    setNow(new Date(2026, 10, 13, 0, 1, 0).getTime());

    expect(guard.getStatus()).toMatchObject({
      day: '2026-11-13',
      spent: 0,
      requests: 0,
      dailyBudget: 4_000,
      observedBudget: null,
      providerRemaining: null,
      autoPaused: false,
      manualAvailable: true,
    });
  });

  it('clears usage on explicit reset', () => {
    const { guard } = createGuard();

    guard.recordSuccess({ cost: 3 });
    const status = guard.reset();

    expect(status.spent).toBe(0);
    expect(status.requests).toBe(0);
  });

  it('normalises invalid costs and allowances', () => {
    const { guard } = createGuard({ dailyBudget: -5, budgetPauseRatio: -1 });

    const status = guard.recordSuccess({ cost: -2, rateLimitRemaining: -1 });

    expect(status.spent).toBe(1);
    expect(status.configuredBudget).toBe(4_000);
    expect(status.providerRemaining).toBeNull();
    expect(status.observedBudget).toBeNull();
    expect(guard.canRequest({ cost: Number.NaN }).cost).toBe(1);
  });

  it('falls back to in-memory state when storage is unavailable', () => {
    const { guard } = createGuard({ storage: null });

    guard.recordSuccess({ cost: 2 });
    expect(guard.getStatus()).toMatchObject({ spent: 2, requests: 1 });
  });

  it('keeps working when storage writes fail', () => {
    const storage = createMemoryStorage();
    const guard = createBudgetGuard({
      storage: {
        ...storage,
        setItem() {
          throw new Error('quota');
        },
      } as Storage,
      now: () => NOON,
      dailyBudget: 10,
    });

    guard.recordSuccess({ cost: 1 });
    expect(guard.getStatus()).toMatchObject({ spent: 1, requests: 1 });
  });

  it('sums a sequence of requests and caps at the hard budget', () => {
    const { guard } = createGuard({ dailyBudget: 2 });

    guard.recordSuccess({ cost: 1 });
    guard.recordSuccess({ cost: 2 });

    expect(guard.getStatus()).toMatchObject({ spent: 2, requests: 2, remaining: 0 });
  });
});
