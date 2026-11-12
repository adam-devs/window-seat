import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollScheduler } from './pollScheduler';

function setup() {
  const run = vi.fn();
  const scheduler = createPollScheduler(run);
  return { run, scheduler };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPollScheduler', () => {
  it('runs once after the requested delay', () => {
    const { run, scheduler } = setup();

    scheduler.schedule(1_000);
    expect(scheduler.isScheduled).toBe(true);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.isScheduled).toBe(false);
  });

  it('replaces a pending poll instead of stacking timers', () => {
    const { run, scheduler } = setup();

    scheduler.schedule(1_000);
    vi.advanceTimersByTime(500);

    scheduler.schedule(2_000);
    // The first timer must not fire at its original deadline.
    vi.advanceTimersByTime(500);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clear cancels the pending poll but allows rescheduling', () => {
    const { run, scheduler } = setup();

    scheduler.schedule(1_000);
    scheduler.clear();
    expect(scheduler.isScheduled).toBe(false);

    vi.advanceTimersByTime(5_000);
    expect(run).not.toHaveBeenCalled();

    scheduler.schedule(100);
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clear is safe when nothing is pending', () => {
    const { run, scheduler } = setup();

    scheduler.clear();
    scheduler.clear();
    vi.runAllTimers();

    expect(run).not.toHaveBeenCalled();
  });

  it('dispose cancels the pending poll and blocks future schedules', () => {
    const { run, scheduler } = setup();

    scheduler.schedule(1_000);
    scheduler.dispose();

    expect(scheduler.isDisposed).toBe(true);
    expect(scheduler.isScheduled).toBe(false);

    vi.advanceTimersByTime(5_000);
    scheduler.schedule(100);
    vi.advanceTimersByTime(5_000);

    expect(run).not.toHaveBeenCalled();
  });

  it('treats non-positive or invalid delays as immediate', () => {
    const { run, scheduler } = setup();

    scheduler.schedule(-5);
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.schedule(Number.NaN);
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
