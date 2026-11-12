import { useState, useCallback } from 'react';
import { FlightMap } from './components/FlightMap';
import { FlightPanel } from './components/FlightPanel';
import { Toolbar } from './components/Toolbar';
import { StatusBanner } from './components/StatusBanner';
import { useFlights } from './hooks/useFlights';
import { useSettings } from './hooks/useSettings';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { deriveStatusBanner } from './data/statusBanner';
import type { BoundingBox } from './types';
import './app.css';

export default function App() {
  const [perimeterBbox, setPerimeterBbox] = useState<BoundingBox | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);

  // Perimeter is the only selection mode. Keeping the bbox in state means a
  // re-render does not look like an area change and abort the in-flight request.
  const activeBbox = perimeterBbox;

  const { settings, setAutoRefreshMs, resetSettings } = useSettings();
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
  } = useFlights(activeBbox, { autoRefreshMs: settings.autoRefreshMs });

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
    setPerimeterBbox(null);
    setSelectedFlight(null);
  }, []);

  return (
    <div className="app">
      <Toolbar
        onRefresh={refresh}
        onClear={handleClear}
        perimeterInstructions={perimeterBbox === null}
        loading={loading}
        autoRefreshMs={settings.autoRefreshMs}
        cadence={cadence}
        budget={budget}
        onAutoRefreshChange={setAutoRefreshMs}
        onResetSettings={resetSettings}
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
            onPerimeterSelected={setPerimeterBbox}
            selectedFlight={selectedFlight}
            onSelectFlight={setSelectedFlight}
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
        />
      </div>
    </div>
  );
}
