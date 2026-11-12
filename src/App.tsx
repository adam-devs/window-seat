import { useState, useCallback, useMemo } from 'react';
import { FlightMap } from './components/FlightMap';
import { FlightPanel } from './components/FlightPanel';
import { Toolbar } from './components/Toolbar';
import { StatusBanner } from './components/StatusBanner';
import { useFlights } from './hooks/useFlights';
import { useSettings } from './hooks/useSettings';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { deriveStatusBanner } from './data/statusBanner';
import { bboxFromPoint } from './utils/opensky';
import type { BoundingBox, SelectionMode } from './types';
import './app.css';

// Geocoding via Nominatim (free, no API key required)
async function geocode(query: string): Promise<[number, number] | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (data.length === 0) return null;
  return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
}

export default function App() {
  const [mode, setMode] = useState<SelectionMode>('location');
  const [radiusKm, setRadiusKm] = useState(150);
  const [locationCenter, setLocationCenter] = useState<[number, number] | null>(null);
  const [perimeterBbox, setPerimeterBbox] = useState<BoundingBox | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  // Active bounding box fed into the hook. Memoized so a re-render does not
  // look like an area change and abort the in-flight request.
  const activeBbox: BoundingBox | null = useMemo(
    () =>
      mode === 'location' && locationCenter
        ? bboxFromPoint(locationCenter[0], locationCenter[1], radiusKm)
        : mode === 'perimeter'
          ? perimeterBbox
          : null,
    [mode, locationCenter, radiusKm, perimeterBbox],
  );

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
  const handleLocationSearch = useCallback(async (query: string) => {
    setGeocodeError(null);
    const coords = await geocode(query);
    if (!coords) {
      setGeocodeError(`Location "${query}" not found`);
      return;
    }
    setLocationCenter(coords);
  }, []);

  const handleUseMyLocation = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocationCenter([pos.coords.latitude, pos.coords.longitude]),
      () => setGeocodeError('Could not get your location')
    );
  }, []);

  const handleClear = useCallback(() => {
    setPerimeterBbox(null);
    setLocationCenter(null);
    setSelectedFlight(null);
  }, []);

  const handleModeChange = useCallback((m: SelectionMode) => {
    setMode(m);
    setSelectedFlight(null);
  }, []);

  return (
    <div className="app">
      <Toolbar
        mode={mode}
        onModeChange={handleModeChange}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
        onLocationSearch={handleLocationSearch}
        onUseMyLocation={handleUseMyLocation}
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

      {geocodeError && (
        <div className="geocode-error">{geocodeError}</div>
      )}

      <div className="main">
        <div className="map-container">
          <FlightMap
            flights={flights}
            bbox={activeBbox}
            radiusKm={radiusKm}
            mode={mode}
            locationCenter={locationCenter}
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
