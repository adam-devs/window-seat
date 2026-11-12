import { describe, expect, it } from 'vitest';
import {
  createLastGoodState,
  lastGoodReducer,
  selectCurrent,
  type LastGoodAction,
  type LastGoodState,
} from './lastGood';

interface Row {
  id: string;
}

type RowAction = LastGoodAction<Row>;

const snapshot = (id: string): Row => ({ id });

/** Apply a sequence of actions from an initial state. */
function reduce(
  actions: RowAction[],
  initial: LastGoodState<Row> = createLastGoodState<Row>('A'),
): LastGoodState<Row> {
  return actions.reduce(lastGoodReducer<Row>, initial);
}

/** State for area A with one successful snapshot. */
function loadedA(): LastGoodState<Row> {
  return reduce([
    { type: 'request-start', key: 'A' },
    { type: 'request-success', key: 'A', data: snapshot('first') },
  ]);
}

describe('lastGoodReducer', () => {
  it('selecting a new area discards the previous snapshot', () => {
    const state = lastGoodReducer(loadedA(), { type: 'select-area', key: 'B' });

    expect(state).toEqual({ key: 'B', data: null, error: null });
  });

  it('selecting the same area keeps the snapshot', () => {
    const before = loadedA();
    expect(lastGoodReducer(before, { type: 'select-area', key: 'A' })).toBe(
      before,
    );
  });

  it('selecting no area clears everything', () => {
    const state = lastGoodReducer(loadedA(), { type: 'select-area', key: null });
    expect(state).toEqual({ key: null, data: null, error: null });
  });

  it('starting a request clears a previous error but keeps data', () => {
    const failed = reduce(
      [{ type: 'request-failure', key: 'A', error: new Error('offline') }],
      loadedA(),
    );
    expect(failed.data).not.toBeNull();
    expect(failed.error).toBeInstanceOf(Error);

    const started = lastGoodReducer(failed, { type: 'request-start', key: 'A' });

    expect(started.data).toEqual(snapshot('first'));
    expect(started.error).toBeNull();
  });

  it('returns the same state when a request starts with no error', () => {
    const before = loadedA();
    expect(lastGoodReducer(before, { type: 'request-start', key: 'A' })).toBe(
      before,
    );
  });

  it('a failed refresh never blanks last-good data', () => {
    const error = new Error('429');
    const failed = lastGoodReducer(loadedA(), {
      type: 'request-failure',
      key: 'A',
      error,
    });

    expect(failed.data).toEqual(snapshot('first'));
    expect(failed.error).toBe(error);
    expect(failed.key).toBe('A');
  });

  it('keeps the failure when the very first request fails', () => {
    const error = new Error('network');
    const failed = reduce([{ type: 'request-failure', key: 'A', error }]);

    expect(failed.data).toBeNull();
    expect(failed.error).toBe(error);
  });

  it('a successful refresh replaces data and clears the error', () => {
    const failed = reduce(
      [{ type: 'request-failure', key: 'A', error: new Error('offline') }],
      loadedA(),
    );

    const recovered = lastGoodReducer(failed, {
      type: 'request-success',
      key: 'A',
      data: snapshot('second'),
    });

    expect(recovered.data).toEqual(snapshot('second'));
    expect(recovered.error).toBeNull();
  });

  it('a successful empty refresh replaces data with an empty result', () => {
    const state = lastGoodReducer<Row[]>(
      { key: 'A', data: [snapshot('first')], error: null },
      { type: 'request-success', key: 'A', data: [] },
    );

    expect(state.data).toHaveLength(0);
  });

  it('ignores outcomes for a different area', () => {
    const before = loadedA();

    expect(lastGoodReducer(before, { type: 'request-start', key: 'B' })).toBe(
      before,
    );
    expect(
      lastGoodReducer(before, {
        type: 'request-success',
        key: 'B',
        data: snapshot('stale'),
      }),
    ).toBe(before);
    expect(
      lastGoodReducer(before, {
        type: 'request-failure',
        key: 'B',
        error: new Error('late'),
      }),
    ).toBe(before);
  });

  it('ignores an error for the previous area after switching', () => {
    const moved = lastGoodReducer(loadedA(), {
      type: 'select-area',
      key: 'B',
    });

    const late = lastGoodReducer(moved, {
      type: 'request-failure',
      key: 'A',
      error: new Error('late'),
    });

    expect(late).toBe(moved);
    expect(late.data).toBeNull();
    expect(late.error).toBeNull();
  });

  it('returns the same state for an unknown action', () => {
    const before = loadedA();
    // Simulate a future action type reaching an older reducer.
    const unknown = { type: 'unknown' } as unknown as RowAction;

    expect(lastGoodReducer(before, unknown)).toBe(before);
  });
});

describe('selectCurrent', () => {
  it('returns data for the active area', () => {
    const state = loadedA();
    expect(selectCurrent(state, 'A').data).toEqual(snapshot('first'));
  });

  it('hides data for another area during the transition frame', () => {
    const state = loadedA();
    expect(selectCurrent(state, 'B')).toEqual({ data: null, error: null });
  });

  it('exposes the error for the active area even with data', () => {
    const error = new Error('timeout');
    const state = lastGoodReducer(loadedA(), {
      type: 'request-failure',
      key: 'A',
      error,
    });

    expect(selectCurrent(state, 'A')).toEqual({
      data: snapshot('first'),
      error,
    });
  });

  it('returns nothing when no area is selected', () => {
    expect(selectCurrent(loadedA(), null)).toEqual({ data: null, error: null });
  });
});
