/**
 * Keyed last-good data store.
 *
 * A failed refresh must never erase the snapshot the UI is already showing. This
 * reducer encodes that rule in one place so `useFlights` only has to dispatch
 * request outcomes.
 *
 * The `key` is the area (bounding box) a snapshot belongs to. Changing areas
 * discards old data; refresh failures within the same area keep it.
 */

export interface LastGoodState<T> {
  /** Area key this state describes; null when no area is selected. */
  key: string | null;
  /** Last successful data for `key`. Failures never clear it. */
  data: T | null;
  /** Latest failure for `key`, cleared when a request starts or succeeds. */
  error: unknown | null;
}

export type LastGoodAction<T> =
  | { type: 'select-area'; key: string | null }
  | { type: 'request-start'; key: string }
  | { type: 'request-success'; key: string; data: T }
  | { type: 'request-failure'; key: string; error: unknown };

export function createLastGoodState<T>(
  key: string | null = null,
): LastGoodState<T> {
  return { key, data: null, error: null };
}

/**
 * Apply a request outcome.
 *
 * Outcomes for any key other than the selected area are ignored, so a slow
 * response from a previous area can never overwrite the current one.
 */
export function lastGoodReducer<T>(
  state: LastGoodState<T>,
  action: LastGoodAction<T>,
): LastGoodState<T> {
  switch (action.type) {
    case 'select-area':
      if (action.key === state.key) return state;
      return createLastGoodState(action.key);

    case 'request-start':
      if (action.key !== state.key) return state;
      return state.error === null ? state : { ...state, error: null };

    case 'request-success':
      if (action.key !== state.key) return state;
      return { key: state.key, data: action.data, error: null };

    case 'request-failure':
      if (action.key !== state.key) return state;
      // Keep `data`: a transient failure must not blank the map.
      return { ...state, error: action.error };

    default:
      return state;
  }
}

/**
 * Read the part of the store that matches the area currently on screen.
 *
 * The effect that dispatches `select-area` runs after render, so a selector is
 * still needed to avoid showing the previous area's data for one frame.
 */
export function selectCurrent<T>(
  state: LastGoodState<T>,
  key: string | null,
): { data: T | null; error: unknown | null } {
  if (state.key !== key) return { data: null, error: null };
  return { data: state.data, error: state.error };
}
