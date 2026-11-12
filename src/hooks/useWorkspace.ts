import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundingBox, SelectionMode } from '../types';
import type { ProviderId } from '../data/types';
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_STORAGE_KEY,
  type DirectionalSelection,
  type ThemePreference,
  type UnitSystem,
  type Workspace,
  loadWorkspace,
  parseWorkspace,
  parseWorkspaceJson,
  saveWorkspace,
} from '../workspace';

export interface UseWorkspaceResult {
  workspace: Workspace;
  setPerimeter: (perimeter: BoundingBox | null) => void;
  setMode: (mode: SelectionMode) => void;
  setDirection: (direction: DirectionalSelection | null) => void;
  setUnits: (units: UnitSystem) => void;
  setTheme: (theme: ThemePreference) => void;
  setAutoRefreshMs: (ms: number) => void;
  setProviderId: (id: ProviderId | null) => void;
  resetWorkspace: () => void;
}

/**
 * Shared workspace state backed by the versioned `localStorage` store.
 *
 * Persistence is synchronous. Storage failures degrade to in-memory state.
 * M3.2 will wire this into startup restore; M3.4 will expose units/theme.
 */
export function useWorkspace(): UseWorkspaceResult {
  const [workspace, setWorkspaceState] = useState<Workspace>(() =>
    loadWorkspace(),
  );
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const apply = useCallback((next: Workspace) => {
    const normalized = parseWorkspace(next);
    workspaceRef.current = normalized;
    saveWorkspace(normalized);
    setWorkspaceState(normalized);
  }, []);

  const setPerimeter = useCallback(
    (perimeter: BoundingBox | null) => {
      apply({ ...workspaceRef.current, perimeter });
    },
    [apply],
  );

  const setMode = useCallback(
    (mode: SelectionMode) => {
      apply({ ...workspaceRef.current, mode });
    },
    [apply],
  );

  const setDirection = useCallback(
    (direction: DirectionalSelection | null) => {
      apply({
        ...workspaceRef.current,
        direction,
        // Pinching a view implies View mode, but clearing it keeps the current
        // mode so the user can immediately pin a new origin.
        mode: direction ? 'direction' : workspaceRef.current.mode,
      });
    },
    [apply],
  );

  const setUnits = useCallback(
    (units: UnitSystem) => {
      apply({ ...workspaceRef.current, units });
    },
    [apply],
  );

  const setTheme = useCallback(
    (theme: ThemePreference) => {
      apply({ ...workspaceRef.current, theme });
    },
    [apply],
  );

  const setAutoRefreshMs = useCallback(
    (ms: number) => {
      apply({ ...workspaceRef.current, autoRefreshMs: ms });
    },
    [apply],
  );

  const setProviderId = useCallback(
    (providerId: ProviderId | null) => {
      apply({ ...workspaceRef.current, providerId });
    },
    [apply],
  );

  const resetWorkspace = useCallback(() => {
    apply(DEFAULT_WORKSPACE);
  }, [apply]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      if (window.localStorage.getItem(WORKSPACE_STORAGE_KEY) === null) {
        saveWorkspace(workspaceRef.current);
      }
    } catch {
      // Storage can be unavailable in private mode; in-memory state still works.
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== WORKSPACE_STORAGE_KEY) return;
      setWorkspaceState(parseWorkspaceJson(event.newValue));
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return {
    workspace,
    setPerimeter,
    setMode,
    setDirection,
    setUnits,
    setTheme,
    setAutoRefreshMs,
    setProviderId,
    resetWorkspace,
  };
}
