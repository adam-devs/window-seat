import { memo, useEffect, useMemo, useState } from 'react';
import type { Aircraft } from '../data/types';
import type { FlightStatus } from '../data/flightStatus';
import type { SelectionMode } from '../types';
import {
  DEFAULT_FLIGHT_VIEW,
  filterAndSortFlights,
  type FlightFilter,
  type FlightSort,
} from '../data/flightView';
import { deriveFlightListState } from '../data/flightListState';
import { derivePanelHeader } from '../data/panelHeader';
import {
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
} from '../data/units';
import type { UnitSystem } from '../workspace';

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
  mode: SelectionMode;
  units: UnitSystem;
  /** Phones render the panel as a collapsible bottom sheet. */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

interface FlightRowProps {
  flight: Aircraft;
  selected: boolean;
  onSelectFlight: (icao24: string | null) => void;
  units: UnitSystem;
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
    previous.units === next.units &&
    a.icao24 === b.icao24 &&
    a.callsign === b.callsign &&
    a.origin_country === b.origin_country &&
    a.baro_altitude === b.baro_altitude &&
    a.velocity === b.velocity &&
    a.on_ground === b.on_ground
  );
}

const FlightRow = memo(function FlightRow({
  flight,
  selected,
  onSelectFlight,
  units,
}: FlightRowProps) {
  return (
    <button
      type="button"
      className={`flight-row ${selected ? 'active' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelectFlight(selected ? null : flight.icao24)}
    >
      <span className="flight-row-main">
        <span className="row-callsign">{flight.callsign ?? 'N/A'}</span>
        <span className="row-country">{flight.origin_country ?? '—'}</span>
      </span>
      <span className="flight-row-sub">
        <span>{formatAltitude(flight.baro_altitude, units)}</span>
        <span>{formatSpeed(flight.velocity, units)}</span>
        {flight.on_ground && <span className="row-ground">On ground</span>}
      </span>
    </button>
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
  mode,
  units,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
}: FlightPanelProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FlightSort>(DEFAULT_FLIGHT_VIEW.sort);
  const [filter, setFilter] = useState<FlightFilter>(
    DEFAULT_FLIGHT_VIEW.filter,
  );
  const [lastKnownSelected, setLastKnownSelected] = useState<Aircraft | null>(
    null,
  );

  const airborne = flights.filter((flight) => !flight.on_ground);
  const onGround = flights.filter((flight) => flight.on_ground);
  const selectedFromFlights =
    flights.find((flight) => flight.icao24 === selectedFlight) ?? null;
  const selected =
    selectedFromFlights ??
    (lastKnownSelected?.icao24 === selectedFlight ? lastKnownSelected : null);
  const lostContact = selected !== null && selectedFromFlights === null;

  useEffect(() => {
    if (!selectedFlight) {
      setLastKnownSelected(null);
      return;
    }
    if (selectedFromFlights) setLastKnownSelected(selectedFromFlights);
  }, [selectedFlight, selectedFromFlights]);

  const visibleFlights = useMemo(
    () => filterAndSortFlights(flights, { query, sort, filter }),
    [flights, query, sort, filter],
  );
  const filtersActive =
    query.trim() !== '' || filter !== DEFAULT_FLIGHT_VIEW.filter;
  const count =
    filter === 'all'
      ? flights.length
      : filter === 'on-ground'
        ? onGround.length
        : airborne.length;
  const countLabel =
    filter === 'on-ground'
      ? `${count} on ground`
      : `${count} aircraft in ${mode === 'direction' ? 'view' : 'area'}`;

  // Last-good rows stay rendered through refreshes and failures; this only
  // describes the empty case.
  const listState = deriveFlightListState({
    hasArea,
    status,
    visibleCount: visibleFlights.length,
    filtersActive: filtersActive && flights.length > 0,
    mode,
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

  function clearFilters(): void {
    setQuery(DEFAULT_FLIGHT_VIEW.query);
    setFilter(DEFAULT_FLIGHT_VIEW.filter);
  }

  const selectionAnnouncement = selected
    ? `Selected ${selected.callsign ?? selected.icao24.toUpperCase()}, ${
        selected.on_ground ? 'on ground' : 'airborne'
      }.`
    : '';

  return (
    <aside
      id="nearby-aircraft"
      className={`flight-panel${collapsed ? ' flight-panel--collapsed' : ''}`}
      aria-label="Nearby aircraft"
      tabIndex={-1}
    >
      {collapsible && (
        <div className="sheet-handle" aria-hidden="true">
          <span />
        </div>
      )}

      <div className="panel-header">
        <div className="panel-title-row">
          <h2>WindowSeat</h2>
          {collapsible && onToggleCollapsed && (
            <button
              type="button"
              className="sheet-toggle"
              aria-expanded={!collapsed}
              aria-controls="flight-panel-body"
              aria-label={`${collapsed ? 'Show' : 'Hide'} aircraft list`}
              onClick={onToggleCollapsed}
            >
              <span aria-hidden="true">{collapsed ? '▴' : '▾'}</span>
              {collapsed ? 'Show list' : 'Hide list'}
            </button>
          )}
        </div>
        <p
          className="subtitle"
          title={header.exactTime ? `Updated at ${header.exactTime}` : undefined}
        >
          {header.text}
        </p>
        {header.provider && <p className="provider">{header.provider}</p>}
        {error && <p className="error-msg">{error}</p>}
        <p className="count">{countLabel}</p>
        <p className="sr-only" role="status" aria-live="polite">
          {selectionAnnouncement}
        </p>
      </div>

      <div
        id="flight-panel-body"
        className="flight-panel-body"
        hidden={collapsed}
      >
        {hasArea && (
          <div className="flight-controls">
            <input
              className="flight-search"
              type="search"
              placeholder="Search callsign or ICAO24…"
              aria-label="Search flights"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flight-control-row">
              <label className="flight-control">
                <span>Sort</span>
                <select
                  aria-label="Sort flights"
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as FlightSort)
                  }
                >
                  <option value="callsign">Callsign A–Z</option>
                  <option value="altitude-desc">Altitude ↓</option>
                  <option value="speed-desc">Speed ↓</option>
                  <option value="vertical-desc">Vertical rate ↓</option>
                  <option value="contact-desc">Last contact ↓</option>
                </select>
              </label>
              <label className="flight-control">
                <span>Show</span>
                <select
                  aria-label="Filter flights"
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value as FlightFilter)
                  }
                >
                  <option value="airborne">Airborne</option>
                  <option value="on-ground">On ground</option>
                  <option value="all">All</option>
                </select>
              </label>
            </div>
            {filtersActive && (
              <div className="flight-view-summary">
                <span aria-live="polite">
                  {visibleFlights.length} of {flights.length} shown
                </span>
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Detail card for selected flight */}
        {selected && (
          <div
            className={`detail-card ${lostContact ? 'detail-card--last-known' : ''}`}
            role="region"
            aria-label={`${selected.callsign ?? selected.icao24.toUpperCase()} details`}
          >
            <div className="detail-header">
              <div className="detail-title">
                <span className="callsign">{selected.callsign ?? 'N/A'}</span>
                {lostContact && (
                  <span className="last-known-badge">Last known</span>
                )}
              </div>
              <button
                type="button"
                className="close-btn"
                aria-label="Close flight details"
                onClick={() => onSelectFlight(null)}
              >
                ✕
              </button>
            </div>
            {lostContact && (
              <p className="last-known-note">
                No longer in the latest snapshot.
              </p>
            )}
            <div className="detail-grid">
              <DetailItem label="ICAO24" value={selected.icao24.toUpperCase()} />
              <DetailItem label="Country" value={selected.origin_country ?? '—'} />
              <DetailItem label="Altitude" value={formatAltitude(selected.baro_altitude, units)} />
              <DetailItem label="Speed" value={formatSpeed(selected.velocity, units)} />
              <DetailItem label="Vertical" value={formatVerticalRate(selected.vertical_rate, units)} />
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
          aria-label="Flight results"
        >
          {listState && (
            <p
              className={`empty-msg empty-msg--${listState.kind}`}
              role="status"
            >
              {listState.message}
            </p>
          )}
          {visibleFlights.map((f) => (
            <FlightRow
              key={f.icao24}
              flight={f}
              selected={f.icao24 === selectedFlight}
              onSelectFlight={onSelectFlight}
              units={units}
            />
          ))}
        </div>
      </div>
    </aside>
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
