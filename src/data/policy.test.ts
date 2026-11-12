import { describe, expect, it } from 'vitest';
import { config } from '../config';
import {
  DAY_MS,
  bboxAreaSqDeg,
  budgetSafeIntervalMs,
  computeCadence,
  estimateCreditCost,
  remainingRequests,
  usableDailyBudget,
} from './policy';

const HOUR_MS = 3_600_000;

function cadence(overrides: Partial<Parameters<typeof computeCadence>[0]> = {}) {
  return computeCadence({
    userIntervalMs: 30_000,
    providerMinIntervalMs: 10_000,
    costPerRequest: 1,
    spentToday: 0,
    dailyBudget: 4_000,
    budgetPauseRatio: 0.9,
    msUntilReset: DAY_MS,
    ...overrides,
  });
}

describe('bboxAreaSqDeg', () => {
  it('multiplies latitude and longitude spans', () => {
    expect(
      bboxAreaSqDeg({ lamin: 51.4, lomin: -0.2, lamax: 51.6, lomax: 0.1 }),
    ).toBeCloseTo(0.06, 10);
  });

  it('wraps across the antimeridian', () => {
    expect(
      bboxAreaSqDeg({ lamin: 0, lomin: 179, lamax: 1, lomax: -179 }),
    ).toBeCloseTo(2, 10);
  });

  it('treats inverted or empty spans as zero', () => {
    expect(bboxAreaSqDeg({ lamin: 10, lomin: 0, lamax: 10, lomax: 0 })).toBe(0);
    expect(bboxAreaSqDeg({ lamin: 10, lomin: 0, lamax: 5, lomax: 2 })).toBe(0);
  });
});

describe('estimateCreditCost', () => {
  it.each([
    ['tiny box', 0.1, 1],
    ['exactly 25 sq°', 25, 1],
    ['just over 25 sq°', 25.1, 2],
    ['exactly 100 sq°', 100, 2],
    ['just over 100 sq°', 100.1, 3],
    ['exactly 400 sq°', 400, 3],
    ['just over 400 sq°', 400.1, 4],
  ])('costs the right credits for %s', (_label, area, expected) => {
    // A square box of the requested area, expressed in degrees.
    const bbox = { lamin: 0, lomin: 0, lamax: 1, lomax: area };
    expect(estimateCreditCost(bbox)).toBe(expected);
  });

  it('matches the default 150 km radius (~0.06 sq°) at one credit', () => {
    expect(
      estimateCreditCost({ lamin: 51.4, lomin: -0.2, lamax: 51.6, lomax: 0.1 }),
    ).toBe(1);
  });
});

describe('usableDailyBudget', () => {
  it('applies the pause ratio and clamps bad values', () => {
    expect(usableDailyBudget(4_000, 0.9)).toBe(3_600);
    expect(usableDailyBudget(4_000, 1.5)).toBe(4_000);
    expect(usableDailyBudget(4_000, -1)).toBe(3_600);
    expect(usableDailyBudget(4_000, Number.NaN)).toBe(3_600);
    expect(usableDailyBudget(-10, 0.9)).toBe(0);
  });

  it('defaults to the configured budget', () => {
    expect(usableDailyBudget()).toBeCloseTo(
      config.dailyBudget * config.budgetPauseRatio,
      10,
    );
  });
});

describe('budgetSafeIntervalMs', () => {
  it('spreads the remaining budget over the reset window', () => {
    expect(budgetSafeIntervalMs(3_600, 1, DAY_MS)).toBe(24_000);
    expect(budgetSafeIntervalMs(600, 1, 12 * HOUR_MS)).toBe(72_000);
    expect(budgetSafeIntervalMs(3_600, 2, DAY_MS)).toBe(48_000);
  });

  it('never returns less than 1 ms', () => {
    expect(budgetSafeIntervalMs(4_000, 1, 1_000)).toBe(1);
  });

  it('returns Infinity when one request is unaffordable', () => {
    expect(budgetSafeIntervalMs(0.5, 1, DAY_MS)).toBe(Number.POSITIVE_INFINITY);
    expect(budgetSafeIntervalMs(0, 1, DAY_MS)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('computeCadence', () => {
  it('keeps the default 30 s cadence inside the budget', () => {
    const result = cadence();

    expect(result.intervalMs).toBe(30_000);
    expect(result.reason).toBe('user');
    expect(result.paused).toBe(false);
    expect(result.throttled).toBe(false);
    expect(result.budgetSafeIntervalMs).toBe(24_000);
    expect(result.dailyCost).toBe(2_880);
  });

  it('lengthens a 15 s choice to the budget-safe interval', () => {
    const result = cadence({ userIntervalMs: 15_000 });

    expect(result.intervalMs).toBe(24_000);
    expect(result.reason).toBe('budget');
    expect(result.throttled).toBe(true);
    expect(result.dailyCost).toBe(3_600);
  });

  it('enforces the provider minimum over a faster user choice', () => {
    const result = cadence({
      userIntervalMs: 2_000,
      dailyBudget: 1_000_000,
      budgetPauseRatio: 1,
    });

    expect(result.intervalMs).toBe(10_000);
    expect(result.reason).toBe('provider');
    expect(result.throttled).toBe(true);
  });

  it('uses the remaining budget and the time until reset', () => {
    const result = cadence({
      userIntervalMs: 15_000,
      spentToday: 3_000,
      msUntilReset: 12 * HOUR_MS,
    });

    // 600 credits left over 12 h = one request every 72 s.
    expect(result.remainingBudget).toBe(600);
    expect(result.budgetSafeIntervalMs).toBe(72_000);
    expect(result.intervalMs).toBe(72_000);
    expect(result.reason).toBe('budget');
  });

  it('pauses once the budget cannot pay for another request', () => {
    const result = cadence({ spentToday: 3_600 });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe('budget');
    expect(result.intervalMs).toBe(Number.POSITIVE_INFINITY);
    expect(result.budgetSafeIntervalMs).toBe(Number.POSITIVE_INFINITY);
    expect(result.dailyCost).toBe(0);
  });

  it('pauses only when the remaining budget is below one request cost', () => {
    const short = cadence({ spentToday: 3_599.25 });
    expect(short.paused).toBe(true);

    const exact = cadence({ spentToday: 3_599 });
    expect(exact.paused).toBe(false);
    expect(exact.remainingBudget).toBe(1);
  });

  it('accounts for a larger bounding box costing two credits', () => {
    const result = cadence({
      userIntervalMs: 15_000,
      costPerRequest: 2,
    });

    expect(result.intervalMs).toBe(48_000);
    expect(result.reason).toBe('budget');
    expect(result.dailyCost).toBe(3_600);
  });

  it('ignores an exhausted window and keeps the user cadence', () => {
    const result = cadence({ msUntilReset: 0 });

    expect(result.budgetSafeIntervalMs).toBe(1);
    expect(result.intervalMs).toBe(30_000);
    expect(result.reason).toBe('user');
  });

  it('normalises invalid and negative input', () => {
    const result = cadence({
      userIntervalMs: Number.NaN,
      providerMinIntervalMs: -5,
      costPerRequest: 0,
      spentToday: -10,
      dailyBudget: Number.POSITIVE_INFINITY,
      budgetPauseRatio: 2,
      msUntilReset: Number.NaN,
    });

    expect(result.userIntervalMs).toBe(0);
    expect(result.providerMinIntervalMs).toBe(0);
    expect(result.costPerRequest).toBe(1);
    expect(result.spentToday).toBe(0);
    expect(result.dailyBudget).toBe(config.dailyBudget);
    expect(result.budgetPauseRatio).toBe(1);
    expect(result.msUntilReset).toBe(DAY_MS);
    expect(result.intervalMs).toBe(21_600);
  });

  it('reports remaining request count for the UI', () => {
    const result = cadence({ spentToday: 1_000, costPerRequest: 2 });

    expect(remainingRequests(result)).toBe(1_300);
  });
});
