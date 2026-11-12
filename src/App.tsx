import { useState, useCallback, useEffect, useRef } from 'react';
import { FlightMap } from './components/FlightMap';
import { FlightPanel } from './components/FlightPanel';
import { Toolbar } from './components/Toolbar';
import { StatusBanner } from './components/StatusBanner';
import { useFlights } from './hooks/useFlights';
import { useWorkspace } from './hooks/useWorkspace';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { deriveStatusBanner } from './data/statusBanner';
import { DEFAULT_SETTINGS } from './settings';
import './app.css';

export default function App() {
  const { workspace, setPerimeter, setAutoRefreshMs, setUnits } =
    useWorkspace();
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);

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
    setPerimeter(null);
    setSelectedFlight(null);
  }, [setPerimeter]);

  const resetRefreshInterval = useCallback(() => {
    setAutoRefreshMs(DEFAULT_SETTINGS.autoRefreshMs);
  }, [setAutoRefreshMs]);

  return (
    <div className="app">
      <Toolbar
        onRefresh={refresh}
        onClear={handleClear}
        perimeterInstructions={activeBbox === null}
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
