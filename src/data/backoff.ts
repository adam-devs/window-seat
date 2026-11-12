import { config } from '../config';
import {
  isAbortError,
  isProviderError,
  type ProviderErrorKind,
} from './errors';

/**
 * Retry backoff for transient provider failures.
 *
 * 429, 5xx, and transport failures use exponential backoff with symmetric
 * jitter. A provider `Retry-After` hint acts as a floor, so OpenSky's
 * `x-rate-limit-retry-after-seconds` is respected even when it is longer than
 * the normal ceiling.
 *
 * The controller is stateless with respect to timers: it only reports the delay
 * and `nextRetryAt`. The hook owns scheduling and cancellation.
 */

export type BackoffReason = 'retry' | 'success' | 'not-retryable' | 'aborted';

export interface BackoffState {
  /** Consecutive retryable failures. Resets on success. */
  attempts: number;
  /** Delay chosen for the most recent retryable failure. */
  lastDelayMs: number | null;
  /** Epoch ms when the next attempt is due, while retrying. */
  nextRetryAt: number | null;
  lastFailureAt: number | null;
  lastErrorKind: ProviderErrorKind | null;
}

export interface BackoffDecision {
  /** True only for a retryable failure; scheduling should happen. */
  retry: boolean;
  reason: BackoffReason;
  /** Delay before the next attempt, when `retry` is true. */
  delayMs: number | null;
  /** Epoch ms of the next attempt, when `retry` is true. */
  nextRetryAt: number | null;
  state: BackoffState;
}

export interface BackoffDelayOptions {
  baseMs?: number;
  maxMs?: number;
  /** Symmetric jitter around the exponential value, 0–1. */
  jitterRatio?: number;
  /** Injectable for deterministic tests; defaults to `Math.random`. */
  random?: () => number;
}

export interface BackoffOptions extends BackoffDelayOptions {
  now?: () => number;
}

export interface BackoffController {
  /** Consecutive retryable failures. */
  readonly attempts: number;
  /** Snapshot of the current backoff state. */
  getState(): BackoffState;
  recordFailure(error: unknown): BackoffDecision;
  /** Reset the attempt counter and clear `nextRetryAt`. */
  recordSuccess(): BackoffDecision;
  reset(): BackoffState;
}

function initialState(): BackoffState {
  return {
    attempts: 0,
    lastDelayMs: null,
    nextRetryAt: null,
    lastFailureAt: null,
    lastErrorKind: null,
  };
}

function copyState(state: BackoffState): BackoffState {
  return { ...state };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function toJitterRatio(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return config.backoffJitterRatio;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Exponential delay with symmetric jitter.
 *
 * `attempt` is 1-based. The exponential part is capped at `maxMs`; jitter is
 * applied afterwards and the final value is capped again so it never exceeds
 * the ceiling.
 */
export function backoffDelayMs(
  attempt: number,
  options: BackoffDelayOptions = {},
): number {
  const baseMs = positiveOr(options.baseMs, config.backoffBaseMs);
  const maxMs = Math.max(baseMs, positiveOr(options.maxMs, config.backoffMaxMs));
  const jitterRatio = toJitterRatio(options.jitterRatio);
  const random = options.random ?? Math.random;

  const step = Number.isFinite(attempt) && attempt > 1 ? Math.floor(attempt) - 1 : 0;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(step, 30));

  const sample = Math.min(1, Math.max(0, random()));
  const jittered = exponential * (1 + (sample * 2 - 1) * jitterRatio);

  return Math.max(1, Math.round(Math.min(maxMs, jittered)));
}

/** True for failures worth retrying automatically. */
export function isRetryableError(error: unknown): boolean {
  if (!isProviderError(error)) return false;
  return (
    error.kind === 'rate-limited' ||
    error.kind === 'server' ||
    error.kind === 'network'
  );
}

function retryAfterMs(error: unknown): number | null {
  if (!isProviderError(error)) return null;
  const hint = error.retryAfterMs;
  if (typeof hint !== 'number' || !Number.isFinite(hint) || hint < 0) return null;
  return Math.round(hint);
}

function retryDelayMs(
  attempt: number,
  error: unknown,
  options: BackoffDelayOptions,
): number {
  const delay = backoffDelayMs(attempt, options);
  const hint = retryAfterMs(error);
  return hint === null ? delay : Math.max(delay, hint);
}

/**
 * Create a backoff controller.
 *
 * Sequence: `recordFailure` for every failed request, `recordSuccess` after a
 * successful one. Aborts are neutral and do not increment the attempt count.
 */
export function createBackoff(options: BackoffOptions = {}): BackoffController {
  const now = options.now ?? Date.now;
  let state = initialState();

  function decision(
    reason: BackoffReason,
    nextState: BackoffState,
  ): BackoffDecision {
    const retry = reason === 'retry';
    return {
      retry,
      reason,
      delayMs: retry ? nextState.lastDelayMs : null,
      nextRetryAt: retry ? nextState.nextRetryAt : null,
      state: copyState(nextState),
    };
  }

  return {
    get attempts() {
      return state.attempts;
    },

    getState() {
      return copyState(state);
    },

    recordFailure(error) {
      // Switching areas or unmounting cancels a request; that is not a failure
      // and must not lengthen the next retry.
      if (isAbortError(error)) {
        return decision('aborted', state);
      }

      if (!isRetryableError(error)) {
        state = initialState();
        return decision('not-retryable', state);
      }

      const timestamp = now();
      const attempts = state.attempts + 1;
      const delayMs = retryDelayMs(attempts, error, options);
      const kind = isProviderError(error) ? error.kind : null;

      state = {
        attempts,
        lastDelayMs: delayMs,
        nextRetryAt: timestamp + delayMs,
        lastFailureAt: timestamp,
        lastErrorKind: kind,
      };

      return decision('retry', state);
    },

    recordSuccess() {
      state = initialState();
      return decision('success', state);
    },

    reset() {
      state = initialState();
      return copyState(state);
    },
  };
}
