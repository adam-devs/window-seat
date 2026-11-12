import { memo } from 'react';
import type { Aircraft } from '../data/types';
import type { FlightStatus } from '../data/flightStatus';
import { deriveFlightListState } from '../data/flightListState';
import { derivePanelHeader } from '../data/panelHeader';
import { msToKnots, mToFeet } from '../utils/opensky';

interface FlightPanelProps {
  flights: Aircraft[];
  selectedFlight: string | null;
  onSelectFlight: (icao24: string | null) => void;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  dataAgeMs: number | null;
  providerName: string;
  hasArea: boolean;
  status: FlightStatus;
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

interface FlightRowProps {
  flight: Aircraft;
  selected: boolean;
  onSelectFlight: (icao24: string | null) => void;
}

function flightRowPropsEqual(
  previous: FlightRowProps,
  next: FlightRowProps,
): boolean {
  const a = previous.flight;
  const b = next.flight;
  return (
    previous.selected === next.selected &&
    previous.onSelectFlight === next.onSelectFlight &&
    a.icao24 === b.icao24 &&
    a.callsign === b.callsign &&
    a.origin_country === b.origin_country &&
    a.baro_altitude === b.baro_altitude &&
    a.velocity === b.velocity
  );
}

const FlightRow = memo(function FlightRow({
  flight,
  selected,
  onSelectFlight,
}: FlightRowProps) {
  return (
    <div
      className={`flight-row ${selected ? 'active' : ''}`}
      onClick={() => onSelectFlight(selected ? null : flight.icao24)}
    >
      <div className="flight-row-main">
        <span className="row-callsign">{flight.callsign ?? 'N/A'}</span>
        <span className="row-country">{flight.origin_country ?? '—'}</span>
      </div>
      <div className="flight-row-sub">
        <span>{altitudeLabel(flight.baro_altitude)}</span>
        <span>{speedLabel(flight.velocity)}</span>
      </div>
    </div>
  );
}, flightRowPropsEqual);

export function FlightPanel({
  flights,
  selectedFlight,
  onSelectFlight,
  loading,
  error,
  lastUpdated,
  dataAgeMs,
  providerName,
  hasArea,
  status,
}: FlightPanelProps) {
  const airborne = flights.filter((f) => !f.on_ground);
  const selected = flights.find((f) => f.icao24 === selectedFlight) ?? null;
  // Last-good rows stay rendered through refreshes and failures; this only
  // describes the empty case.
  const listState = deriveFlightListState({
    hasArea,
    status,
    visibleCount: airborne.length,
  });
  // First load may replace the header text; a background refresh appends to the
  // existing "Updated …" line instead of hiding it.
  const header = derivePanelHeader({
    hasArea,
    hasData: lastUpdated !== null,
    status,
    lastUpdated,
    dataAgeMs,
    providerName,
  });

  return (
    <div className="flight-panel">
      <div className="panel-header">
        <h2>SkyWatch</h2>
        <p
          className="subtitle"
          title={header.exactTime ? `Updated at ${header.exactTime}` : undefined}
        >
          {header.text}
        </p>
        {header.provider && <p className="provider">{header.provider}</p>}
        {error && <p className="error-msg">{error}</p>}
        <p className="count">{airborne.length} aircraft in area</p>
      </div>

      {/* Detail card for selected flight */}
      {selected && (
        <div className="detail-card">
          <div className="detail-header">
            <span className="callsign">{selected.callsign ?? 'N/A'}</span>
            <button
              type="button"
              className="close-btn"
              aria-label="Close flight details"
              onClick={() => onSelectFlight(null)}
            >
              ✕
            </button>
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
      <div
        className="flight-list"
        aria-busy={loading}
        aria-label="Nearby aircraft"
      >
        {listState && (
          <p
            className={`empty-msg empty-msg--${listState.kind}`}
            role="status"
          >
            {listState.message}
          </p>
        )}
        {airborne.map((f) => (
          <FlightRow
            key={f.icao24}
            flight={f}
            selected={f.icao24 === selectedFlight}
            onSelectFlight={onSelectFlight}
          />
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
