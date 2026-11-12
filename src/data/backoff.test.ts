import { describe, expect, it } from 'vitest';
import { ProviderError, type ProviderErrorKind } from './errors';
import {
  backoffDelayMs,
  createBackoff,
  isRetryableError,
} from './backoff';

const BASE = 2_000;
const MAX = 60_000;

function noJitter() {
  return { baseMs: BASE, maxMs: MAX, jitterRatio: 0, random: () => 0.5 };
}

function transient(kind: ProviderErrorKind, retryAfterMs?: number) {
  return new ProviderError(kind, `test ${kind}`, { retryAfterMs });
}

describe('backoffDelayMs', () => {
  it('grows exponentially without jitter', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelayMs(attempt, noJitter())),
    ).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  it('caps the delay at the configured maximum', () => {
    expect(backoffDelayMs(30, noJitter())).toBe(MAX);
    expect(
      backoffDelayMs(30, { baseMs: 10, maxMs: 50, jitterRatio: 0, random: () => 0.5 }),
    ).toBe(50);
  });

  it('applies symmetric jitter around the exponential value', () => {
    const options = {
      baseMs: BASE,
      maxMs: MAX,
      jitterRatio: 0.2,
    };

    expect(backoffDelayMs(1, { ...options, random: () => 0 })).toBe(1_600);
    expect(backoffDelayMs(1, { ...options, random: () => 0.5 })).toBe(2_000);
    expect(backoffDelayMs(1, { ...options, random: () => 1 })).toBe(2_400);
    expect(backoffDelayMs(2, { ...options, random: () => 0 })).toBe(3_200);
  });

  it('never exceeds the ceiling after jitter', () => {
    expect(
      backoffDelayMs(1, {
        baseMs: 1_000,
        maxMs: 1_000,
        jitterRatio: 0.5,
        random: () => 1,
      }),
    ).toBe(1_000);
  });

  it('treats attempt values below 1 as the first retry', () => {
    expect(backoffDelayMs(0, noJitter())).toBe(BASE);
    expect(backoffDelayMs(-5, noJitter())).toBe(BASE);
    expect(backoffDelayMs(Number.NaN, noJitter())).toBe(BASE);
  });

  it('falls back to configured defaults for invalid options', () => {
    expect(
      backoffDelayMs(1, {
        baseMs: Number.NaN,
        maxMs: -1,
        jitterRatio: Number.NaN,
        random: () => 0.5,
      }),
    ).toBe(2_000);
  });
});

describe('isRetryableError', () => {
  it.each<[ProviderErrorKind, boolean]>([
    ['rate-limited', true],
    ['server', true],
    ['network', true],
    ['aborted', false],
    ['unauthorized', false],
    ['http', false],
    ['bad-response', false],
  ])('classifies %s as retryable=%s', (kind, retryable) => {
    expect(isRetryableError(transient(kind))).toBe(retryable);
  });

  it('does not retry non-provider errors', () => {
    expect(isRetryableError(new Error('plain'))).toBe(false);
    expect(isRetryableError('nope')).toBe(false);
  });
});

describe('createBackoff', () => {
  function create(now = 100_000) {
    let current = now;
    const controller = createBackoff({
      ...noJitter(),
      now: () => current,
    });

    return {
      controller,
      setNow(value: number) {
        current = value;
      },
    };
  }

  it('starts idle', () => {
    const { controller } = create();

    expect(controller.getState()).toEqual({
      attempts: 0,
      lastDelayMs: null,
      nextRetryAt: null,
      lastFailureAt: null,
      lastErrorKind: null,
    });
  });

  it('schedules exponential retries and exposes nextRetryAt', () => {    const { controller, setNow } = create();

    const first = controller.recordFailure(transient('network'));
    expect(first).toMatchObject({
      retry: true,
      reason: 'retry',
      delayMs: 2_000,
      nextRetryAt: 102_000,
      state: {
        attempts: 1,
        lastDelayMs: 2_000,
        nextRetryAt: 102_000,
        lastFailureAt: 100_000,
        lastErrorKind: 'network',
      },
    });

    setNow(120_000);
    const second = controller.recordFailure(transient('server'));
    expect(second).toMatchObject({
      retry: true,
      delayMs: 4_000,
      nextRetryAt: 124_000,
      state: { attempts: 2 },
    });

    setNow(200_000);
    const capped = controller.recordFailure(transient('rate-limited'));
    expect(capped).toMatchObject({
      retry: true,
      delayMs: 8_000,
      nextRetryAt: 208_000,
      state: { attempts: 3 },
    });
  });

  it('caps attempts at the maximum delay', () => {
    const { controller } = create();

    for (let i = 0; i < 10; i += 1) {
      controller.recordFailure(transient('network'));
    }

    expect(controller.getState()).toMatchObject({
      attempts: 10,
      lastDelayMs: MAX,
    });
  });

  it('honours Retry-After as a floor', () => {
    const { controller } = create();

    const decision = controller.recordFailure(transient('rate-limited', 30_000));

    expect(decision).toMatchObject({
      retry: true,
      delayMs: 30_000,
      nextRetryAt: 130_000,
    });
  });

  it('ignores a Retry-After hint shorter than the exponential delay', () => {
    const { controller } = create();

    expect(controller.recordFailure(transient('rate-limited', 500))).toMatchObject({
      delayMs: 2_000,
    });
  });

  it('honours provider hints longer than the normal ceiling', () => {
    const { controller } = create();

    expect(
      controller.recordFailure(transient('rate-limited', 120_000)),
    ).toMatchObject({
      delayMs: 120_000,
      nextRetryAt: 220_000,
    });
  });

  it('resets on success', () => {
    const { controller } = create();

    controller.recordFailure(transient('network'));
    controller.recordFailure(transient('server'));

    const success = controller.recordSuccess();

    expect(success).toMatchObject({
      retry: false,
      reason: 'success',
      delayMs: null,
      nextRetryAt: null,
      state: {
        attempts: 0,
        lastDelayMs: null,
        nextRetryAt: null,
        lastFailureAt: null,
        lastErrorKind: null,
      },
    });
    expect(controller.getState().attempts).toBe(0);
  });

  it('does not count aborts as failures', () => {
    const { controller } = create();

    controller.recordFailure(transient('network'));
    const aborted = controller.recordFailure(new DOMException('stop', 'AbortError'));

    expect(aborted).toMatchObject({
      retry: false,
      reason: 'aborted',
      delayMs: null,
      nextRetryAt: null,
    });
    expect(controller.getState().attempts).toBe(1);
  });

  it('recognises provider abort errors', () => {
    const { controller } = create();

    expect(controller.recordFailure(transient('aborted'))).toMatchObject({
      retry: false,
      reason: 'aborted',
    });
    expect(controller.getState().attempts).toBe(0);
  });

  it.each<[ProviderErrorKind, string]>([
    ['unauthorized', 'not-retryable'],
    ['http', 'not-retryable'],
    ['bad-response', 'not-retryable'],
  ])('does not retry %s and clears pending state', (kind, reason) => {
    const { controller } = create();

    controller.recordFailure(transient('network'));
    const decision = controller.recordFailure(transient(kind));

    expect(decision).toMatchObject({
      retry: false,
      reason,
      delayMs: null,
      nextRetryAt: null,
      state: { attempts: 0, nextRetryAt: null },
    });
  });

  it('applies jitter through the controller', () => {
    let current = 10_000;
    const controller = createBackoff({
      baseMs: BASE,
      maxMs: MAX,
      jitterRatio: 0.2,
      random: () => 0,
      now: () => current,
    });

    expect(controller.recordFailure(transient('network'))).toMatchObject({
      delayMs: 1_600,
      nextRetryAt: 11_600,
    });

    current = 20_000;
    expect(controller.recordFailure(transient('server'))).toMatchObject({
      delayMs: 3_200,
      nextRetryAt: 23_200,
    });
  });

  it('resets explicitly', () => {
    const { controller } = create();

    controller.recordFailure(transient('network'));
    const state = controller.reset();

    expect(state).toEqual({
      attempts: 0,
      lastDelayMs: null,
      nextRetryAt: null,
      lastFailureAt: null,
      lastErrorKind: null,
    });
  });
});
