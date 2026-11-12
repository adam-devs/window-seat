import { useState, useCallback, useEffect, useRef } from 'react';
import { FlightMap } from './components/FlightMap';
import { FlightPanel } from './components/FlightPanel';
import { Toolbar } from './components/Toolbar';
import { StatusBanner } from './components/StatusBanner';
import { useFlights } from './hooks/useFlights';
import { useWorkspace } from './hooks/useWorkspace';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { deriveStatusBanner } from './data/statusBanner';
import type {
  DirectionalOrigin,
  DirectionalSelection,
} from './data/directionalView';
import type { SelectionMode } from './types';
import { DEFAULT_SETTINGS } from './settings';
import './app.css';

export default function App() {
  const {
    workspace,
    setPerimeter,
    setDirection,
    setMode,
    setAutoRefreshMs,
    setUnits,
  } = useWorkspace();
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  // The first View click only pins the origin; the direction is created by the
  // second click. Keeping it here lets Clear and mode changes reset the step and
  // lets the toolbar explain what to click next.
  const [pendingDirectionOrigin, setPendingDirectionOrigin] =
    useState<DirectionalOrigin | null>(null);

  // The restored or drawn perimeter is the single source of truth. Persisting
  // it keeps startup and cross-tab state consistent.
  const activeBbox = workspace.perimeter;
  const areaKey = activeBbox
    ? `${activeBbox.lamin}:${activeBbox.lomin}:${activeBbox.lamax}:${activeBbox.lomax}`
    : null;
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
  } = useFlights(activeBbox, { autoRefreshMs: workspace.autoRefreshMs });

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
        hasPerimeter={workspace.perimeter !== null}
        hasDirection={workspace.direction !== null}
        hasPendingOrigin={pendingDirectionOrigin !== null}
        loading={loading}
        autoRefreshMs={workspace.autoRefreshMs}
        units={workspace.units}
        cadence={cadence}
        budget={budget}
        onAutoRefreshChange={setAutoRefreshMs}
        onUnitsChange={setUnits}
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
            flights={flights}
            bbox={activeBbox}
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
            units={workspace.units}
          />
        </div>

        <FlightPanel
          flights={flights}
          selectedFlight={selectedFlight}
          onSelectFlight={setSelectedFlight}
          loading={loading}
          error={error}
          lastUpdated={lastUpdated}
          dataAgeMs={dataAgeMs}
          providerName={providerName}
          hasArea={activeBbox !== null}
          status={status}
          units={workspace.units}
        />
      </div>
    </div>
  );
}
