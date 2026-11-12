/**
 * Single-flight request coordinator.
 *
 * Only one task runs at a time. Starting a request for a new key aborts the
 * active request and queues the newest one; it starts after the active task has
 * settled, so requests never overlap. Repeated requests for the same key while
 * it is running share the active promise instead of issuing another request.
 *
 * The coordinator does not know about React, providers, or timers. The hook
 * supplies the task and uses `cancel`/`dispose` for area changes and unmounts.
 */

export type RequestTask<T> = (signal: AbortSignal) => Promise<T>;

export interface CoordinatorRequest<T> {
  /** Stable identity, typically a serialized bounding box. */
  key: string;
  task: RequestTask<T>;
}

export interface RequestCoordinator<T> {
  /** Start or join a request. Superseded requests reject with an abort error. */
  run(request: CoordinatorRequest<T>): Promise<T>;
  /** Abort the active request and drop any queued one. */
  cancel(reason?: unknown): void;
  /** Cancel and reject future requests. Use on unmount. */
  dispose(reason?: unknown): void;
  /** Key of the request currently in flight, if any. */
  readonly activeKey: string | null;
  /** Key of the request waiting for the active one to settle, if any. */
  readonly pendingKey: string | null;
  /** True while a task is running (including an aborted task that has not settled). */
  readonly isRunning: boolean;
  /** True when nothing is running or queued. */
  readonly isIdle: boolean;
  /** Number of tasks actually started; useful for diagnostics and tests. */
  readonly startedCount: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface ActiveRequest<T> {
  key: string;
  controller: AbortController;
  deferred: Deferred<T>;
}

interface PendingRequest<T> {
  key: string;
  task: RequestTask<T>;
  deferred: Deferred<T>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Error shape recognised by `isAbortError` (name `AbortError`). */
export function createAbortError(message = 'Request aborted'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function abortErrorFromSignal(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : createAbortError(fallback);
}

/**
 * Create a latest-wins single-flight coordinator.
 *
 * `run` never overlaps tasks; a new key aborts the current task and waits for it
 * to settle before starting the newest queued task.
 */
export function createRequestCoordinator<T>(): RequestCoordinator<T> {
  let active: ActiveRequest<T> | null = null;
  let pending: PendingRequest<T> | null = null;
  let disposed = false;
  let startedCount = 0;

  function startNext(): void {
    if (disposed || active || !pending) return;

    const item = pending;
    pending = null;

    const controller = new AbortController();
    const activeRequest: ActiveRequest<T> = {
      key: item.key,
      controller,
      deferred: item.deferred,
    };
    active = activeRequest;
    startedCount += 1;

    void (async () => {
      try {
        const result = await item.task(controller.signal);
        // A superseded task that ignored the abort must not report success.
        if (controller.signal.aborted) {
          throw abortErrorFromSignal(controller.signal, 'Request superseded');
        }
        item.deferred.resolve(result);
      } catch (error) {
        item.deferred.reject(error);
      } finally {
        if (active === activeRequest) active = null;
        startNext();
      }
    })();
  }

  function rejectPending(error: Error): void {
    if (!pending) return;
    pending.deferred.reject(error);
    pending = null;
  }

  function cancel(reason?: unknown): void {
    const error = reason instanceof Error ? reason : createAbortError('Request cancelled');
    rejectPending(error);
    active?.controller.abort(error);
  }

  return {
    run({ key, task }) {
      if (disposed) {
        return Promise.reject(createAbortError('Request coordinator disposed'));
      }

      // Same key and still running: join the in-flight request. If a newer
      // request was queued meanwhile, the latest intent wins and the queued one
      // is dropped.
      if (active && active.key === key && !active.controller.signal.aborted) {
        rejectPending(createAbortError('Superseded by a repeated request'));
        return active.deferred.promise;
      }

      const superseded = createAbortError('Superseded by a new request');
      rejectPending(superseded);
      active?.controller.abort(superseded);

      const request: PendingRequest<T> = {
        key,
        task,
        deferred: deferred<T>(),
      };
      pending = request;
      startNext();

      return request.deferred.promise;
    },

    cancel,

    dispose(reason?: unknown) {
      disposed = true;
      cancel(reason);
    },

    get activeKey() {
      return active?.key ?? null;
    },

    get pendingKey() {
      return pending?.key ?? null;
    },

    get isRunning() {
      return active !== null;
    },

    get isIdle() {
      return active === null && pending === null;
    },

    get startedCount() {
      return startedCount;
    },
  };
}
