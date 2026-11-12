import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { FlightMap } from './components/FlightMap';
import { FlightPanel } from './components/FlightPanel';
import { Toolbar } from './components/Toolbar';
import { StatusBanner } from './components/StatusBanner';
import { useFlights } from './hooks/useFlights';
import { useWorkspace } from './hooks/useWorkspace';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { deriveStatusBanner } from './data/statusBanner';
import {
  updateDirectionalSelection,
  type DirectionalOrigin,
  type DirectionalSelection,
} from './data/directionalView';
import type { SelectionMode } from './types';
import {
  bboxKey,
  filterFlightsForSelection,
  selectionBbox,
} from './data/selectionArea';
import {
  addSavedSelection,
  createSavedDirection,
  createSavedPerimeter,
  deleteSavedSelection,
  renameSavedSelection,
  touchSavedSelection,
  updateSavedSelection,
} from './data/savedSelections';
import { DEFAULT_SETTINGS } from './settings';
import './app.css';

export default function App() {
  const {
    workspace,
    setPerimeter,
    setDirection,
    setMode,
    setSavedSelections,
    setAutoRefreshMs,
    setUnits,
  } = useWorkspace();
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  // Restoring a saved entry re-fits the map even when the geometry is already
  // active, so incrementing this token is meaningful.
  const [fitToken, setFitToken] = useState(0);
  // The first View click only pins the origin; the direction is created by the
  // second click. Keeping it here lets Clear and mode changes reset the step and
  // lets the toolbar explain what to click next.
  const [pendingDirectionOrigin, setPendingDirectionOrigin] =
    useState<DirectionalOrigin | null>(null);

  // Perimeter mode queries the drawn rectangle; View mode queries the cone's
  // enclosing bbox and filters the snapshot client-side. The memo is keyed by
  // the bbox geometry, not object identity, so unrelated workspace writes
  // (units, theme, refresh) do not look like area changes to the flight hook.
  const candidateBbox = selectionBbox({
    mode: workspace.mode,
    perimeter: workspace.perimeter,
    direction: workspace.direction,
  });
  const candidateBboxKey = bboxKey(candidateBbox);
  const activeBbox = useMemo(
    () => candidateBbox,
    [candidateBboxKey],
  );

  const directionKey = workspace.direction
    ? `${workspace.direction.origin.latitude}:${workspace.direction.origin.longitude}:${workspace.direction.bearingDeg}:${workspace.direction.angleDeg}:${workspace.direction.visibilityKm}`
    : null;
  // Rekey data for every selection change, including a bearing/angle change
  // that happens to leave the provider bbox unchanged.
  const selectionKey =
    candidateBboxKey === null
      ? null
      : workspace.mode === 'direction'
        ? `direction:${directionKey ?? candidateBboxKey}`
        : `perimeter:${candidateBboxKey}`;
  const areaKey = selectionKey;
  const previousAreaKey = useRef(areaKey);

  useEffect(() => {
    if (previousAreaKey.current === areaKey) return;
    previousAreaKey.current = areaKey;
    setSelectedFlight(null);
  }, [areaKey]);

  const online = useOnlineStatus();
  const {
    flights,
    loading,
    error,
    lastUpdated,
    status,
    lastSuccessAt,
    dataAgeMs,
    nextRetryAt,
    cadence,
    budget,
    providerName,
    refresh,
  } = useFlights(activeBbox, {
    autoRefreshMs: workspace.autoRefreshMs,
    selectionKey,
  });

  const visibleFlights = useMemo(
    () =>
      filterFlightsForSelection(
        flights,
        workspace.mode,
        workspace.direction,
      ),
    // The direction key captures the geometry without depending on the
    // re-parsed workspace object identity.
    [flights, workspace.mode, directionKey],
  );

  // The banner only explains recoverable states; it never replaces the list.
  const banner = deriveStatusBanner({
    status,
    online,
    hasData: lastSuccessAt !== null,
    error,
    dataAgeMs,
    nextRetryAt,
    providerName,
  });

  // ---- Handlers ----
  const handleClear = useCallback(() => {
    setSelectedFlight(null);
    setPendingDirectionOrigin(null);
    if (workspace.mode === 'direction') {
      setDirection(null);
    } else {
      setPerimeter(null);
    }
  }, [workspace.mode, setPerimeter, setDirection]);

  const handleModeChange = useCallback(
    (mode: SelectionMode) => {
      setPendingDirectionOrigin(null);
      setMode(mode);
    },
    [setMode],
  );

  const handleDirectionChange = useCallback(
    (direction: DirectionalSelection | null) => {
      if (direction) setPendingDirectionOrigin(null);
      setDirection(direction);
    },
    [setDirection],
  );

  const handlePendingDirectionOriginChange = useCallback(
    (origin: DirectionalOrigin | null) => {
      setPendingDirectionOrigin(origin);
    },
    [],
  );

  const handleVisibilityChange = useCallback(
    (visibilityKm: number) => {
      const current = workspace.direction;
      if (!current) return;
      setDirection(
        updateDirectionalSelection(current, { visibilityKm }),
      );
    },
    [workspace.direction, setDirection],
  );

  const handleSaveSelection = useCallback(
    (name: string) => {
      if (workspace.mode === 'direction') {
        if (!workspace.direction) return;
        const entry = createSavedDirection(
          workspace.direction,
          workspace.savedSelections,
          { name },
        );
        if (entry) {
          setSavedSelections(
            addSavedSelection(workspace.savedSelections, entry),
          );
        }
        return;
      }

      if (!workspace.perimeter) return;
      const entry = createSavedPerimeter(
        workspace.perimeter,
        workspace.savedSelections,
        { name },
      );
      if (entry) {
        setSavedSelections(
          addSavedSelection(workspace.savedSelections, entry),
        );
      }
    },
    [
      workspace.mode,
      workspace.perimeter,
      workspace.direction,
      workspace.savedSelections,
      setSavedSelections,
    ],
  );

  const handleUpdateSelection = useCallback(
    (id: string) => {
      const entry = workspace.savedSelections.find(
        (selection) => selection.id === id,
      );
      if (!entry) return;

      if (entry.kind === 'perimeter') {
        if (!workspace.perimeter) return;
        setSavedSelections(
          updateSavedSelection(workspace.savedSelections, id, {
            ...entry,
            perimeter: workspace.perimeter,
          }),
        );
        return;
      }

      if (!workspace.direction) return;
      setSavedSelections(
        updateSavedSelection(workspace.savedSelections, id, {
          ...entry,
          direction: workspace.direction,
        }),
      );
    },
    [
      workspace.savedSelections,
      workspace.perimeter,
      workspace.direction,
      setSavedSelections,
    ],
  );

  const handleRestoreSelection = useCallback(
    (id: string) => {
      const entry = workspace.savedSelections.find(
        (selection) => selection.id === id,
      );
      if (!entry) return;

      setSelectedFlight(null);
      setPendingDirectionOrigin(null);
      if (entry.kind === 'perimeter') {
        setPerimeter(entry.perimeter);
        setMode('perimeter');
      } else {
        setDirection(entry.direction);
      }
      setSavedSelections(
        touchSavedSelection(workspace.savedSelections, entry.id),
      );
      setFitToken((token) => token + 1);
    },
    [
      workspace.savedSelections,
      setPerimeter,
      setMode,
      setDirection,
      setSavedSelections,
    ],
  );

  const handleRenameSelection = useCallback(
    (id: string, name: string) => {
      setSavedSelections(
        renameSavedSelection(workspace.savedSelections, id, name),
      );
    },
    [workspace.savedSelections, setSavedSelections],
  );

  const handleDeleteSelection = useCallback(
    (id: string) => {
      setSavedSelections(
        deleteSavedSelection(workspace.savedSelections, id),
      );
    },
    [workspace.savedSelections, setSavedSelections],
  );

  const resetRefreshInterval = useCallback(() => {
    setAutoRefreshMs(DEFAULT_SETTINGS.autoRefreshMs);
  }, [setAutoRefreshMs]);

  return (
    <div className="app">
      <Toolbar
        onRefresh={refresh}
        onClear={handleClear}
        mode={workspace.mode}
        onModeChange={handleModeChange}
        perimeter={workspace.perimeter}
        hasDirection={workspace.direction !== null}
        hasPendingOrigin={pendingDirectionOrigin !== null}
        direction={workspace.direction}
        savedSelections={workspace.savedSelections}
        loading={loading}
        autoRefreshMs={workspace.autoRefreshMs}
        units={workspace.units}
        cadence={cadence}
        budget={budget}
        onAutoRefreshChange={setAutoRefreshMs}
        onUnitsChange={setUnits}
        onVisibilityChange={handleVisibilityChange}
        onSaveSelection={handleSaveSelection}
        onUpdateSelection={handleUpdateSelection}
        onRestoreSelection={handleRestoreSelection}
        onRenameSelection={handleRenameSelection}
        onDeleteSelection={handleDeleteSelection}
        onResetSettings={resetRefreshInterval}
      />

      <StatusBanner
        model={banner}
        onRefresh={refresh}
        refreshing={loading}
      />

      <div className="main">
        <div className="map-container">
          <FlightMap
            flights={visibleFlights}
            bbox={activeBbox}
            perimeter={workspace.perimeter}
            mode={workspace.mode}
            direction={workspace.direction}
            pendingDirectionOrigin={pendingDirectionOrigin}
            onPendingDirectionOriginChange={
              handlePendingDirectionOriginChange
            }
            onDirectionChange={handleDirectionChange}
            onPerimeterSelected={setPerimeter}
            selectedFlight={selectedFlight}
            onSelectFlight={setSelectedFlight}
            refreshIntervalMs={workspace.autoRefreshMs}
            fitToken={fitToken}
            units={workspace.units}
          />
        </div>

        <FlightPanel
          flights={visibleFlights}
          selectedFlight={selectedFlight}
          onSelectFlight={setSelectedFlight}
          loading={loading}
          error={error}
          lastUpdated={lastUpdated}
          dataAgeMs={dataAgeMs}
          providerName={providerName}
          hasArea={activeBbox !== null}
          status={status}
          mode={workspace.mode}
          units={workspace.units}
        />
      </div>
    </div>
  );
}
