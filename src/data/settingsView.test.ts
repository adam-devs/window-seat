import { describe, expect, it } from 'vitest';
import type { BudgetStatus } from './budget';
import type { Cadence } from './policy';
import {
  autoPauseThreshold,
  describeEffectiveCadence,
} from './settingsView';

const cadence: Cadence = {
  intervalMs: 30_000,
  reason: 'user',
  paused: false,
  throttled: false,
  userIntervalMs: 30_000,
  providerMinIntervalMs: 10_000,
  costPerRequest: 1,
  dailyBudget: 4_000,
  budgetPauseRatio: 0.9,
  usableBudget: 3_600,
  spentToday: 100,
  remainingBudget: 3_900,
  budgetSafeIntervalMs: 30_000,
  dailyCost: 2_880,
  msUntilReset: 43_200_000,
};

const budget: BudgetStatus = {
  providerId: 'opensky',
  day: '2026-11-12',
  configuredBudget: 4_000,
  dailyBudget: 4_000,
  budgetPauseRatio: 0.9,
  usableBudget: 3_600,
  spent: 100,
  requests: 100,
  providerRemaining: null,
  observedBudget: null,
  remaining: 3_900,
  autoRemaining: 3_500,
  autoPaused: false,
  manualAvailable: true,
  resetAt: Date.now() + 43_200_000,
  msUntilReset: 43_200_000,
  updatedAt: Date.now(),
};

describe('describeEffectiveCadence', () => {
  it('explains a user-controlled cadence', () => {
    expect(describeEffectiveCadence(cadence)).toBe(
      'Effective interval: 30 s',
    );
  });

  it('explains a budget-limited cadence', () => {
    expect(
      describeEffectiveCadence({
        ...cadence,
        intervalMs: 180_000,
        reason: 'budget',
        throttled: true,
      }),
    ).toBe('Effective interval: 3 min (limited by today’s budget)');
  });

  it('explains a provider-limited cadence', () => {
    expect(
      describeEffectiveCadence({
        ...cadence,
        intervalMs: 15_000,
        reason: 'provider',
        throttled: true,
      }),
    ).toBe('Effective interval: 15 s (provider minimum)');
  });

  it('explains the paused state', () => {
    expect(
      describeEffectiveCadence({
        ...cadence,
        intervalMs: Infinity,
        reason: 'budget',
        paused: true,
      }),
    ).toContain('paused because today’s budget is used');
  });

  it('handles a missing cadence', () => {
    expect(describeEffectiveCadence(null)).toBe(
      'Effective interval unavailable until an area is selected.',
    );
  });
});

describe('autoPauseThreshold', () => {
  it('derives the credit threshold from the pause ratio', () => {
    expect(autoPauseThreshold(budget)).toBe(3_600);
    expect(
      autoPauseThreshold({ ...budget, dailyBudget: 400, budgetPauseRatio: 0.9 }),
    ).toBe(360);
  });
});
