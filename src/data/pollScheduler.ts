/**
 * Single pending-poll timer.
 *
 * Polling must never leave a timer behind after an area change or unmount, and
 * rescheduling (manual refresh, visibility return, retry) must replace the
 * pending timer rather than queue another. Keeping that rule in a tiny helper
 * makes the cleanup behaviour directly testable.
 */

export interface PollScheduler {
  /** Replace any pending poll with one due after `delayMs`. */
  schedule(delayMs: number): void;
  /** Cancel a pending poll without permanently disabling the scheduler. */
  clear(): void;
  /** Cancel and prevent any future scheduling. */
  dispose(): void;
  readonly isScheduled: boolean;
  readonly isDisposed: boolean;
}

export function createPollScheduler(run: () => void): PollScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    schedule(delayMs: number) {
      if (disposed) return;

      // Replacing (not stacking) timers is the whole point: a manual refresh or
      // retry must not leave the previous poll queued.
      clear();

      const delay =
        Number.isFinite(delayMs) && delayMs > 0 ? Math.round(delayMs) : 0;
      timer = setTimeout(() => {
        timer = null;
        if (disposed) return;
        run();
      }, delay);
    },

    clear,

    dispose() {
      disposed = true;
      clear();
    },

    get isScheduled() {
      return timer !== null;
    },

    get isDisposed() {
      return disposed;
    },
  };
}
