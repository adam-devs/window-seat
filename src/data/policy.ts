import { config, requestsPerDay } from '../config';
import type { BoundingBox } from '../types';

/**
 * Request cadence policy.
 *
 * The effective interval is the slowest of three constraints:
 *
 * 1. the user's preferred interval,
 * 2. the provider's minimum interval (terms / time resolution),
 * 3. the interval needed to keep the area-based credit cost inside the
 *    auto-refresh share of the daily budget for the rest of the day.
 *
 * Nothing here performs I/O or keeps state. Budget tracking lives in the guard
 * (M1.3.2); this module only turns the current numbers into a cadence.
 */

export const DAY_MS = 86_400_000;

export type CadenceReason = 'user' | 'provider' | 'budget';

export interface CadenceInput {
  /** Interval selected by the user, in ms. Invalid values are treated as 0. */
  userIntervalMs: number;
  /** Provider floor, in ms (see `FlightProvider.minIntervalMs`). */
  providerMinIntervalMs: number;
  /** Credits one request for the active bounding box costs (1–4 for OpenSky). */
  costPerRequest?: number;
  /** Credits already spent today for this provider. */
  spentToday?: number;
  /** Provider daily allowance, in credits. Defaults to `config.dailyBudget`. */
  dailyBudget?: number;
  /** Share of the budget auto-refresh may consume. Defaults to config. */
  budgetPauseRatio?: number;
  /** Time until the daily budget resets. Defaults to a full day. */
  msUntilReset?: number;
}

export interface Cadence {
  /** Effective gap between automatic requests, in ms. `Infinity` when paused. */
  intervalMs: number;
  /** Which constraint produced `intervalMs`. */
  reason: CadenceReason;
  /** True when the remaining budget cannot pay for another request. */
  paused: boolean;
  /** True when the effective interval is slower than the user's choice. */
  throttled: boolean;
  userIntervalMs: number;
  providerMinIntervalMs: number;

  costPerRequest: number;
  dailyBudget: number;
  budgetPauseRatio: number;
  /** Budget auto-refresh may use today, after the reserve. */
  usableBudget: number;
  spentToday: number;
  remainingBudget: number;
  /** Interval that makes the remaining budget last until reset. */
  budgetSafeIntervalMs: number;
  /** Credits per day at the effective interval; 0 while paused. */
  dailyCost: number;
  msUntilReset: number;
}

/** Convert a credit amount into a whole number of requests. */
function creditsToRequests(credits: number, costPerRequest: number): number {
  return credits / costPerRequest;
}

/**
 * Area of a bounding box in square degrees.
 *
 * Longitudes may wrap the antimeridian (`lomax < lomin`), in which case the
 * shorter eastward span is used.
 */
export function bboxAreaSqDeg(bbox: BoundingBox): number {
  const height = Math.max(0, bbox.lamax - bbox.lamin);
  let width = bbox.lomax - bbox.lomin;
  if (width < 0) width += 360;
  return Math.max(0, width) * height;
}

/**
 * Estimate OpenSky credits for one `/states/all` request.
 *
 * The published buckets are: ≤25 sq° = 1, ≤100 = 2, ≤400 = 3, larger = 4.
 * Boundaries are inclusive; see the research notes in `TASKS.md`.
 */
export function estimateCreditCost(bbox: BoundingBox): number {
  const area = bboxAreaSqDeg(bbox);
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

/** Credits available to auto-refresh at the given pause threshold. */
export function usableDailyBudget(
  dailyBudget: number = config.dailyBudget,
  pauseRatio: number = config.budgetPauseRatio,
): number {
  const budget = Number.isFinite(dailyBudget) ? Math.max(0, dailyBudget) : 0;
  const ratio =
    Number.isFinite(pauseRatio) && pauseRatio >= 0
      ? Math.min(1, pauseRatio)
      : config.budgetPauseRatio;
  return budget * ratio;
}

/**
 * Slowest interval that keeps `credits` lasting until the reset, assuming the
 * cadence continues.
 *
 * Returns `Infinity` when the remaining budget cannot afford one request.
 */
export function budgetSafeIntervalMs(
  remainingCredits: number,
  costPerRequest: number,
  windowMs: number,
): number {
  const cost = Number.isFinite(costPerRequest) && costPerRequest > 0 ? costPerRequest : 1;
  const remaining = Number.isFinite(remainingCredits) ? remainingCredits : 0;
  if (remaining < cost) return Number.POSITIVE_INFINITY;

  const window = Number.isFinite(windowMs) ? Math.max(0, windowMs) : DAY_MS;
  return Math.max(1, Math.ceil((window * cost) / remaining));
}

/**
 * Resolve the three constraints into one cadence.
 *
 * The result is explainable for the settings UI: `reason` says why the
 * effective interval differs from the user's choice, and `throttled` is true
 * whenever it is slower.
 */
export function computeCadence(input: CadenceInput): Cadence {
  const userIntervalMs =
    Number.isFinite(input.userIntervalMs) && input.userIntervalMs > 0
      ? input.userIntervalMs
      : 0;
  const providerMinIntervalMs =
    Number.isFinite(input.providerMinIntervalMs) && input.providerMinIntervalMs > 0
      ? input.providerMinIntervalMs
      : 0;
  const costPerRequest =
    Number.isFinite(input.costPerRequest) && (input.costPerRequest ?? 0) > 0
      ? (input.costPerRequest as number)
      : 1;

  const dailyBudget =
    Number.isFinite(input.dailyBudget) && (input.dailyBudget ?? 0) >= 0
      ? (input.dailyBudget as number)
      : config.dailyBudget;
  const budgetPauseRatio =
    Number.isFinite(input.budgetPauseRatio) && (input.budgetPauseRatio ?? -1) >= 0
      ? Math.min(1, input.budgetPauseRatio as number)
      : config.budgetPauseRatio;

  const spentToday =
    Number.isFinite(input.spentToday) && (input.spentToday as number) > 0
      ? (input.spentToday as number)
      : 0;
  const msUntilReset =
    Number.isFinite(input.msUntilReset) && (input.msUntilReset as number) >= 0
      ? (input.msUntilReset as number)
      : DAY_MS;

  const usableBudget = usableDailyBudget(dailyBudget, budgetPauseRatio);
  const remainingBudget = Math.max(0, usableBudget - spentToday);

  const budgetSafe = budgetSafeIntervalMs(remainingBudget, costPerRequest, msUntilReset);

  // Start with the user's preference, then lengthen for each floor. Ties keep
  // the earlier (more user-visible) reason.
  let intervalMs = userIntervalMs;
  let reason: CadenceReason = 'user';

  if (providerMinIntervalMs > intervalMs) {
    intervalMs = providerMinIntervalMs;
    reason = 'provider';
  }
  if (budgetSafe > intervalMs) {
    intervalMs = budgetSafe;
    reason = 'budget';
  }

  const paused = budgetSafe === Number.POSITIVE_INFINITY;
  if (paused) intervalMs = Number.POSITIVE_INFINITY;

  const dailyCost = paused ? 0 : requestsPerDay(intervalMs) * costPerRequest;

  return {
    intervalMs,
    reason,
    paused,
    throttled: intervalMs > userIntervalMs,
    userIntervalMs,
    providerMinIntervalMs,
    costPerRequest,
    dailyBudget,
    budgetPauseRatio,
    usableBudget,
    spentToday,
    remainingBudget,
    budgetSafeIntervalMs: budgetSafe,
    dailyCost,
    msUntilReset,
  };
}

/** Requests the remaining budget can still pay for at the given cost. */
export function remainingRequests(cadence: Cadence): number {
  return Math.floor(creditsToRequests(cadence.remainingBudget, cadence.costPerRequest));
}
