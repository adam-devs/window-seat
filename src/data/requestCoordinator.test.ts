import { describe, expect, it } from 'vitest';
import {
  createAbortError,
  createRequestCoordinator,
  type RequestTask,
} from './requestCoordinator';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function controllable<T>() {
  const calls: Array<{
    signal: AbortSignal;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  const task: RequestTask<T> = (signal) =>
    new Promise<T>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason ?? createAbortError()), {
        once: true,
      });
    });

  return { task, calls };
}

describe('createRequestCoordinator', () => {
  it('starts a request immediately and clears state when it settles', async () => {
    const coordinator = createRequestCoordinator<string>();
    const { task, calls } = controllable<string>();

    const promise = coordinator.run({ key: 'A', task });

    expect(calls).toHaveLength(1);
    expect(coordinator.activeKey).toBe('A');
    expect(coordinator.pendingKey).toBeNull();
    expect(coordinator.isRunning).toBe(true);
    expect(coordinator.isIdle).toBe(false);
    expect(coordinator.startedCount).toBe(1);

    calls[0].resolve('done');
    await expect(promise).resolves.toBe('done');
    await flush();

    expect(coordinator.activeKey).toBeNull();
    expect(coordinator.isRunning).toBe(false);
    expect(coordinator.isIdle).toBe(true);
  });

  it('joins the active request for the same key instead of starting another', async () => {
    const coordinator = createRequestCoordinator<string>();
    const { task, calls } = controllable<string>();

    const first = coordinator.run({ key: 'A', task });
    const second = coordinator.run({ key: 'A', task });

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(coordinator.startedCount).toBe(1);

    calls[0].resolve('shared');
    await expect(first).resolves.toBe('shared');
    await expect(second).resolves.toBe('shared');
  });

  it('aborts the active request and waits for it to settle before starting a new key', async () => {
    const coordinator = createRequestCoordinator<string>();
    const first = controllable<string>();
    const second = controllable<string>();

    const promiseA = coordinator.run({ key: 'A', task: first.task });
    const promiseB = coordinator.run({ key: 'B', task: second.task });

    expect(first.calls[0].signal.aborted).toBe(true);
    expect(second.calls).toHaveLength(0);
    expect(coordinator.activeKey).toBe('A');
    expect(coordinator.pendingKey).toBe('B');
    expect(coordinator.startedCount).toBe(1);

    await expect(promiseA).rejects.toMatchObject({ name: 'AbortError' });
    await flush();

    expect(second.calls).toHaveLength(1);
    expect(coordinator.activeKey).toBe('B');
    expect(coordinator.startedCount).toBe(2);

    second.calls[0].resolve('B done');
    await expect(promiseB).resolves.toBe('B done');
  });

  it('drops intermediate keys during rapid changes', async () => {
    const coordinator = createRequestCoordinator<string>();
    const first = controllable<string>();
    const second = controllable<string>();
    const third = controllable<string>();

    const promiseA = coordinator.run({ key: 'A', task: first.task });
    const promiseB = coordinator.run({ key: 'B', task: second.task });
    const promiseC = coordinator.run({ key: 'C', task: third.task });

    const aRejected = expect(promiseA).rejects.toMatchObject({ name: 'AbortError' });
    const bRejected = expect(promiseB).rejects.toMatchObject({ name: 'AbortError' });

    expect(first.calls[0].signal.aborted).toBe(true);
    expect(second.calls).toHaveLength(0);
    expect(coordinator.pendingKey).toBe('C');

    await bRejected;
    expect(second.calls).toHaveLength(0);

    await aRejected;
    await flush();

    expect(second.calls).toHaveLength(0);
    expect(third.calls).toHaveLength(1);
    expect(coordinator.activeKey).toBe('C');
    expect(coordinator.startedCount).toBe(2);

    third.calls[0].resolve('C done');
    await expect(promiseC).resolves.toBe('C done');
  });

  it('drops a queued request when the active key is requested again', async () => {
    const coordinator = createRequestCoordinator<string>();
    const first = controllable<string>();
    const second = controllable<string>();

    const promiseA = coordinator.run({ key: 'A', task: first.task });
    const promiseB = coordinator.run({ key: 'B', task: second.task });
    const repeatedA = coordinator.run({ key: 'A', task: first.task });

    const aResult = promiseA.catch((error) => error);
    const bResult = promiseB.catch((error) => error);

    await bResult;
    await flush();

    // The original A was aborted when B arrived; the newest A starts fresh and
    // B never runs.
    expect(await aResult).toMatchObject({ name: 'AbortError' });
    expect(second.calls).toHaveLength(0);
    expect(coordinator.activeKey).toBe('A');
    expect(coordinator.startedCount).toBe(2);

    first.calls[1].resolve('A again');
    await expect(repeatedA).resolves.toBe('A again');
  });

  it('cancels the active request', async () => {
    const coordinator = createRequestCoordinator<string>();
    const { task, calls } = controllable<string>();

    const promise = coordinator.run({ key: 'A', task });
    coordinator.cancel();

    expect(calls[0].signal.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await flush();

    expect(coordinator.activeKey).toBeNull();
    expect(coordinator.isIdle).toBe(true);
  });

  it('cancels both the active and queued requests', async () => {
    const coordinator = createRequestCoordinator<string>();
    const first = controllable<string>();
    const second = controllable<string>();

    const promiseA = coordinator.run({ key: 'A', task: first.task });
    const promiseB = coordinator.run({ key: 'B', task: second.task });

    coordinator.cancel();

    const aRejected = expect(promiseA).rejects.toMatchObject({ name: 'AbortError' });
    const bRejected = expect(promiseB).rejects.toMatchObject({ name: 'AbortError' });

    await aRejected;
    await bRejected;
    await flush();

    expect(second.calls).toHaveLength(0);
    expect(coordinator.isIdle).toBe(true);
  });

  it('starts a fresh request for the same key after cancellation', async () => {
    const coordinator = createRequestCoordinator<string>();
    const { task, calls } = controllable<string>();

    const first = coordinator.run({ key: 'A', task });
    coordinator.cancel();
    const second = coordinator.run({ key: 'A', task });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await flush();

    expect(calls).toHaveLength(2);
    expect(coordinator.activeKey).toBe('A');
    expect(coordinator.startedCount).toBe(2);

    calls[1].resolve('second');
    await expect(second).resolves.toBe('second');
  });

  it('ignores a result that arrives after the request was superseded', async () => {
    const coordinator = createRequestCoordinator<string>();
    const late: { resolve: ((value: string) => void) | null } = { resolve: null };

    const promiseA = coordinator
      .run({
        key: 'A',
        task: () => new Promise<string>((resolve) => {
          late.resolve = resolve;
        }),
      })
      .catch((error) => error);

    const second = controllable<string>();
    const promiseB = coordinator.run({ key: 'B', task: second.task });

    late.resolve?.('late result');
    expect(await promiseA).toMatchObject({ name: 'AbortError' });

    await flush();
    expect(second.calls).toHaveLength(1);

    second.calls[0].resolve('B');
    await expect(promiseB).resolves.toBe('B');
  });

  it('reports task failures and remains usable', async () => {
    const coordinator = createRequestCoordinator<string>();

    const failed = coordinator.run({
      key: 'A',
      task: async () => {
        throw new Error('boom');
      },
    });

    await expect(failed).rejects.toThrow('boom');
    await flush();
    expect(coordinator.isIdle).toBe(true);

    const { task, calls } = controllable<string>();
    const next = coordinator.run({ key: 'B', task });
    calls[0].resolve('ok');

    await expect(next).resolves.toBe('ok');
    expect(coordinator.startedCount).toBe(2);
  });

  it('rejects new requests after disposal', async () => {
    const coordinator = createRequestCoordinator<string>();
    const { task, calls } = controllable<string>();

    const active = coordinator.run({ key: 'A', task });
    coordinator.dispose();

    await expect(active).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      coordinator.run({ key: 'B', task }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await flush();
    expect(calls).toHaveLength(1);
    expect(coordinator.isIdle).toBe(true);
    expect(coordinator.startedCount).toBe(1);
  });

  it('uses a provided abort reason', async () => {
    const coordinator = createRequestCoordinator<string>();
    const { task, calls } = controllable<string>();
    const reason = new Error('area changed');

    const promise = coordinator.run({ key: 'A', task });
    coordinator.cancel(reason);

    await expect(promise).rejects.toBe(reason);
    expect(calls[0].signal.reason).toBe(reason);
  });
});
