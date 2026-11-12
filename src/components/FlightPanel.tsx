import type { Aircraft } from '../data/types';
import { msToKnots, mToFeet } from '../utils/opensky';

interface FlightPanelProps {
  flights: Aircraft[];
  selectedFlight: string | null;
  onSelectFlight: (icao24: string | null) => void;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

function altitudeLabel(m: number | null): string {
  if (m === null) return '—';
  return `${mToFeet(m).toLocaleString()} ft`;
}

function speedLabel(ms: number | null): string {
  if (ms === null) return '—';
  return `${msToKnots(ms)} kts`;
}

function verticalLabel(ms: number | null): string {
  if (ms === null) return '—';
  const fpm = Math.round(ms * 196.85);
  return fpm >= 0 ? `+${fpm} fpm` : `${fpm} fpm`;
}

export function FlightPanel({
  flights,
  selectedFlight,
  onSelectFlight,
  loading,
  error,
  lastUpdated,
}: FlightPanelProps) {
  const airborne = flights.filter((f) => !f.on_ground);
  const selected = flights.find((f) => f.icao24 === selectedFlight) ?? null;

  return (
    <div className="flight-panel">
      <div className="panel-header">
        <h2>SkyWatch</h2>
        <p className="subtitle">
          {loading
            ? 'Updating…'
            : lastUpdated
            ? `Updated ${lastUpdated.toLocaleTimeString()}`
            : 'No data yet'}
        </p>
        {error && <p className="error-msg">{error}</p>}
        <p className="count">{airborne.length} aircraft in area</p>
      </div>

      {/* Detail card for selected flight */}
      {selected && (
        <div className="detail-card">
          <div className="detail-header">
            <span className="callsign">{selected.callsign ?? 'N/A'}</span>
            <button className="close-btn" onClick={() => onSelectFlight(null)}>✕</button>
          </div>
          <div className="detail-grid">
            <DetailItem label="ICAO24" value={selected.icao24.toUpperCase()} />
            <DetailItem label="Country" value={selected.origin_country ?? '—'} />
            <DetailItem label="Altitude" value={altitudeLabel(selected.baro_altitude)} />
            <DetailItem label="Speed" value={speedLabel(selected.velocity)} />
            <DetailItem label="Vertical" value={verticalLabel(selected.vertical_rate)} />
            <DetailItem label="Heading" value={selected.true_track !== null ? `${Math.round(selected.true_track)}°` : '—'} />
            <DetailItem label="Squawk" value={selected.squawk ?? '—'} />
            <DetailItem label="Status" value={selected.on_ground ? 'On ground' : 'Airborne'} />
          </div>
          <a
            href={`https://www.flightradar24.com/${selected.callsign ?? selected.icao24}`}
            target="_blank"
            rel="noopener noreferrer"
            className="fr24-link"
          >
            View on FlightRadar24 ↗
          </a>
        </div>
      )}

      {/* Flight list */}
      <div className="flight-list">
        {airborne.length === 0 && !loading && (
          <p className="empty-msg">Set a search area on the map to begin tracking.</p>
        )}
        {airborne.map((f) => (
          <div
            key={f.icao24}
            className={`flight-row ${f.icao24 === selectedFlight ? 'active' : ''}`}
            onClick={() => onSelectFlight(f.icao24 === selectedFlight ? null : f.icao24)}
          >
            <div className="flight-row-main">
              <span className="row-callsign">{f.callsign ?? 'N/A'}</span>
              <span className="row-country">{f.origin_country ?? '—'}</span>
            </div>
            <div className="flight-row-sub">
              <span>{altitudeLabel(f.baro_altitude)}</span>
              <span>{speedLabel(f.velocity)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}
