import type { BudgetStatus } from './budget';
import type { Cadence } from './policy';
import { formatInterval } from '../settings';

/**
 * Display helpers for the refresh-settings popover.
 *
 * The effective cadence is always shown, not just the user's chosen value, so
 * a budget or provider constraint is visible where the interval is changed.
 */
export function autoPauseThreshold(budget: BudgetStatus): number {
  return Math.round(budget.dailyBudget * budget.budgetPauseRatio);
}

export function describeEffectiveCadence(cadence: Cadence | null): string {
  if (!cadence) {
    return 'Effective interval unavailable until an area is selected.';
  }

  if (cadence.paused) {
    return 'Automatic refresh is paused because today’s budget is used. It resumes after the daily reset.';
  }

  const base = `Effective interval: ${formatInterval(cadence.intervalMs)}`;

  switch (cadence.reason) {
    case 'budget':
      return `${base} (limited by today’s budget)`;
    case 'provider':
      return `${base} (provider minimum)`;
    case 'user':
      return base;
  }
}
