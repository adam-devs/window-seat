import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import {
  aircraftTypeLabel,
  airlineCodeLabel,
  airlineNameLabel,
  countryCodeToFlag,
  idleEnrichment,
  originAirportLabel,
  originCityLabel,
  type FlightEnrichment,
} from '../data/flightEnrichment';
import { useFlightEnrichment } from '../hooks/useFlightEnrichment';
import {
  CloseIcon,
  GlobeIcon,
  PlaneIcon,
  SearchIcon,
} from './icons';
import { cx, focusRing, inputBase } from './ui';

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
  enrichment: FlightEnrichment;
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
    previous.enrichment === next.enrichment &&
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
  enrichment,
}: FlightRowProps) {
  const flag = countryCodeToFlag(enrichment.origin?.countryCode);
  const city = originCityLabel(enrichment.origin);
  const originLabel = enrichment.origin?.country ?? city;

  return (
    <button
      type="button"
      className={cx(
        'flight-row group flex w-full items-start justify-between gap-3 border-b border-l-2 border-b-border px-4 py-3 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent max-[700px]:min-h-12 max-[700px]:py-3',
        selected
          ? 'active border-l-warning bg-warning-soft/50'
          : 'border-l-transparent hover:bg-surface-2',
      )}
      aria-pressed={selected}
      data-icao24={flight.icao24}
      data-callsign={flight.callsign ?? ''}
      onClick={() => onSelectFlight(selected ? null : flight.icao24)}
    >
      {originLabel && (
        <span className="sr-only">From {originLabel}. </span>
      )}
      <span className="flight-row-main flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="row-flag inline-flex h-4 w-5 shrink-0 items-center justify-center text-sm leading-none"
            aria-hidden="true"
            title={originLabel ? `From ${originLabel}` : 'Origin unknown'}
          >
            {flag ?? (
              <GlobeIcon
                className={cx(
                  'h-3.5 w-3.5 text-faint',
                  enrichment.status === 'loading' && 'animate-pulse',
                )}
              />
            )}
          </span>
          <span className="row-callsign truncate font-mono text-sm font-semibold tracking-wide text-ink">
            {flight.callsign ?? 'N/A'}
          </span>
        </span>
        <span className="row-country truncate text-[11px] text-muted">
          {city ?? flight.origin_country ?? '—'}
        </span>
      </span>
      <span className="flight-row-sub flex shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] tabular-nums text-muted">
        <span>{formatAltitude(flight.baro_altitude, units)}</span>
        <span>{formatSpeed(flight.velocity, units)}</span>
        {flight.on_ground && (
          <span className="row-ground rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-warning-ink">
            On ground
          </span>
        )}
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
  const { getEnrichment, requestEnrichment } = useFlightEnrichment();
  const listRef = useRef<HTMLDivElement>(null);

  const airborne = flights.filter((flight) => !flight.on_ground);
  const onGround = flights.filter((flight) => flight.on_ground);
  const selectedFromFlights =
    flights.find((flight) => flight.icao24 === selectedFlight) ?? null;
  const selected =
    selectedFromFlights ??
    (lastKnownSelected?.icao24 === selectedFlight ? lastKnownSelected : null);
  const lostContact = selected !== null && selectedFromFlights === null;
  const selectedEnrichment = selected
    ? getEnrichment(selected.icao24, selected.callsign)
    : idleEnrichment();
  const selectedFlag = countryCodeToFlag(
    selectedEnrichment.origin?.countryCode,
  );
  const selectedOriginCity = originCityLabel(selectedEnrichment.origin);
  const selectedOriginAirport = originAirportLabel(selectedEnrichment.origin);
  const selectedAircraftType = aircraftTypeLabel(
    selectedEnrichment.aircraft,
  );
  const selectedAirlineName = airlineNameLabel(selectedEnrichment.airline);
  const selectedAirlineHint =
    [
      airlineCodeLabel(selectedEnrichment.airline),
      selectedEnrichment.airline?.country,
    ]
      .filter(Boolean)
      .join(' · ') || null;
  const enrichmentPending =
    selectedEnrichment.status === 'idle' ||
    selectedEnrichment.status === 'loading';

  useEffect(() => {
    if (!selectedFlight) {
      setLastKnownSelected(null);
      return;
    }
    if (selectedFromFlights) setLastKnownSelected(selectedFromFlights);
  }, [selectedFlight, selectedFromFlights]);

  // Selecting a marker-selected aircraft should enrich even when its row is
  // outside the scroll viewport.
  useEffect(() => {
    if (!selected) return;
    requestEnrichment(selected.icao24, selected.callsign);
  }, [selected?.icao24, selected?.callsign, requestEnrichment]);

  const visibleFlights = useMemo(
    () => filterAndSortFlights(flights, { query, sort, filter }),
    [flights, query, sort, filter],
  );

  // Enrich only rows near the visible scroll area. This keeps a busy area from
  // turning into hundreds of metadata requests.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>('[data-icao24]'),
    );
    if (rows.length === 0) return;

    const requestFor = (row: HTMLElement): void => {
      const icao24 = row.dataset.icao24;
      if (icao24) {
        requestEnrichment(icao24, row.dataset.callsign || null);
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      rows.forEach(requestFor);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) requestFor(entry.target as HTMLElement);
        }
      },
      { root, rootMargin: '200px 0px' },
    );
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [visibleFlights, requestEnrichment]);
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
      className={cx(
        'flight-panel absolute bottom-3 right-3 top-3 z-[900] flex w-[320px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-pop max-[700px]:static max-[700px]:bottom-auto max-[700px]:right-auto max-[700px]:top-auto max-[700px]:z-auto max-[700px]:max-h-[50dvh] max-[700px]:w-full max-[700px]:rounded-b-none max-[700px]:rounded-t-2xl max-[700px]:border-x-0 max-[700px]:border-b-0 max-[700px]:pb-[env(safe-area-inset-bottom)] max-[700px]:shadow-2xl',
        collapsed &&
          'flight-panel--collapsed max-[700px]:max-h-none',
      )}
      aria-label="Nearby aircraft"
      tabIndex={-1}
    >
      {collapsible && (
        <div
          className="sheet-handle hidden justify-center pt-2 max-[700px]:flex"
          aria-hidden="true"
        >
          <span className="h-1 w-10 rounded-full bg-border-strong" />
        </div>
      )}

      <div className="panel-header border-b border-border px-4 py-4 max-[700px]:px-4 max-[700px]:py-2.5">
        <div className="panel-title-row flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-ink">
            <PlaneIcon className="h-5 w-5 text-accent" />
            Window Seat
          </h2>
          {collapsible && onToggleCollapsed && (
            <button
              type="button"
              className={cx(
                'sheet-toggle ml-auto hidden items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-ink transition duration-200 hover:border-border-strong max-[700px]:inline-flex',
                focusRing,
              )}
              aria-expanded={!collapsed}
              aria-controls="flight-panel-body"
              aria-label={`${collapsed ? 'Show' : 'Hide'} aircraft list`}
              onClick={onToggleCollapsed}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'transition-transform duration-200',
                  collapsed && 'rotate-180',
                )}
              >
                ▾
              </span>
              {collapsed ? 'Show list' : 'Hide list'}
            </button>
          )}
        </div>
        <p
          className={cx(
            'subtitle mt-1 text-[11px] text-muted',
            collapsed && 'max-[700px]:hidden',
          )}
          title={header.exactTime ? `Updated at ${header.exactTime}` : undefined}
        >
          {header.text}
        </p>
        {header.provider && (
          <p
            className={cx(
              'provider mt-0.5 text-[10px] text-faint',
              collapsed && 'max-[700px]:hidden',
            )}
          >
            {header.provider}
          </p>
        )}
        {error && (
          <p className="error-msg mt-1 text-xs text-danger-ink">{error}</p>
        )}
        <p className="count mt-1.5 text-[13px] text-muted">{countLabel}</p>
        <p className="sr-only" role="status" aria-live="polite">
          {selectionAnnouncement}
        </p>
      </div>

      <div
        id="flight-panel-body"
        className="flight-panel-body flex min-h-0 flex-1 flex-col overflow-hidden"
        hidden={collapsed}
      >
        {hasArea && (
          <div className="flight-controls grid gap-2 border-b border-border px-4 py-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input
                className={cx(
                  'flight-search py-2 pl-8 text-[11px] max-[700px]:min-h-[38px]',
                  inputBase,
                )}
                type="search"
                placeholder="Search callsign or ICAO24…"
                aria-label="Search flights"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flight-control-row flex gap-2">
              <label className="flight-control flex flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                <span>Sort</span>
                <select
                  className={cx(
                    'w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-ink max-[700px]:min-h-[34px]',
                    focusRing,
                  )}
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
              <label className="flight-control flex flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                <span>Show</span>
                <select
                  className={cx(
                    'w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-ink max-[700px]:min-h-[34px]',
                    focusRing,
                  )}
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
              <div className="flight-view-summary flex items-center justify-between gap-2 text-[11px] text-muted">
                <span aria-live="polite">
                  {visibleFlights.length} of {flights.length} shown
                </span>
                <button
                  type="button"
                  className={cx(
                    'rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent-ink transition hover:bg-accent-soft',
                    focusRing,
                  )}
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Detail card for selected flight */}
        {selected && (
          <div
            className={cx(
              'detail-card relative mx-3 mt-3 overflow-hidden rounded-xl border border-border bg-surface-2 p-3 shadow-card',
              lostContact && 'detail-card--last-known border-warning/60',
            )}
            role="region"
            aria-label={`${selected.callsign ?? selected.icao24.toUpperCase()} details`}
          >
            <div className="detail-header flex items-start justify-between gap-2">
              <div className="detail-title flex flex-wrap items-center gap-2">
                <span className="callsign font-mono text-base font-semibold tracking-[0.12em] text-warning-ink">
                  {selected.callsign ?? 'N/A'}
                </span>
                {lostContact && (
                  <span className="last-known-badge rounded-full border border-warning/50 bg-warning-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning-ink">
                    Last known
                  </span>
                )}
              </div>
              <button
                type="button"
                className={cx(
                  'close-btn -mr-1 -mt-1 rounded-md p-1 text-muted transition hover:bg-surface hover:text-ink',
                  focusRing,
                )}
                aria-label="Close flight details"
                onClick={() => onSelectFlight(null)}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            {lostContact && (
              <p className="last-known-note mt-1 text-[11px] text-warning-ink">
                No longer in the latest snapshot.
              </p>
            )}
            <div
              className="my-2 border-t border-dashed border-border"
              aria-hidden="true"
            />
            <div className="detail-grid grid grid-cols-2 gap-x-3 gap-y-2">
              <DetailItem
                label="Likely from"
                className="col-span-2 border-b border-dashed border-border pb-2"
                value={
                  selectedOriginCity ? (
                    <span className="flex items-center gap-1.5">
                      {selectedFlag ? (
                        <span className="text-sm" aria-hidden="true">
                          {selectedFlag}
                        </span>
                      ) : (
                        <GlobeIcon
                          className="h-3.5 w-3.5 shrink-0 text-faint"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{selectedOriginCity}</span>
                    </span>
                  ) : enrichmentPending ? (
                    'Looking up…'
                  ) : (
                    'Unavailable'
                  )
                }
                hint={
                  selectedOriginAirport ??
                  (enrichmentPending
                    ? 'Checking scheduled route…'
                    : 'No scheduled route found')
                }
              />
              <DetailItem
                label="Aircraft"
                className="col-span-2 border-b border-dashed border-border pb-2"
                value={
                  selectedAircraftType ??
                  (enrichmentPending ? 'Looking up…' : 'Unavailable')
                }
                hint={
                  selectedEnrichment.aircraft?.icaoType
                    ? `ICAO type ${selectedEnrichment.aircraft.icaoType}`
                    : null
                }
              />
              {selectedAirlineName && (
                <DetailItem
                  label="Airline"
                  className="col-span-2 border-b border-dashed border-border pb-2"
                  value={selectedAirlineName}
                  hint={selectedAirlineHint}
                />
              )}
              <DetailItem label="ICAO24" value={selected.icao24.toUpperCase()} />
              <DetailItem label="Country" value={selected.origin_country ?? '—'} />
              <DetailItem label="Altitude" value={formatAltitude(selected.baro_altitude, units)} />
              <DetailItem label="Speed" value={formatSpeed(selected.velocity, units)} />
              <DetailItem label="Vertical" value={formatVerticalRate(selected.vertical_rate, units)} />
              <DetailItem label="Heading" value={selected.true_track !== null ? `${Math.round(selected.true_track)}°` : '—'} />
              <DetailItem label="Squawk" value={selected.squawk ?? '—'} />
              <DetailItem label="Status" value={selected.on_ground ? 'On ground' : 'Airborne'} />
            </div>
            <p className="mt-2 text-[9px] leading-snug text-faint">
              Likely scheduled route, airline, and aircraft type via adsbdb.com;
              not confirmed by the observed track.
            </p>
            <a
              href={`https://www.flightradar24.com/${selected.callsign ?? selected.icao24}`}
              target="_blank"
              rel="noopener noreferrer"
              className="fr24-link mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-ink transition hover:underline"
            >
              View on FlightRadar24 ↗
            </a>
          </div>
        )}

        {/* Flight list */}
        <div
          ref={listRef}
          className="flight-list scroll-thin flex-1 overflow-y-auto py-1"
          aria-busy={loading}
          aria-label="Flight results"
        >
          {listState && (
            <p
              className={cx(
                'empty-msg px-4 py-6 text-center text-[13px] text-muted',
                `empty-msg--${listState.kind}`,
                listState.kind === 'unavailable' && 'text-danger-ink',
              )}
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
              enrichment={getEnrichment(f.icao24, f.callsign)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function DetailItem({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'detail-item flex min-w-0 flex-col gap-0.5',
        className,
      )}
    >
      <span className="detail-label text-[10px] uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <span className="detail-value truncate font-mono text-xs font-semibold tabular-nums text-ink">
        {value}
      </span>
      {hint && (
        <span className="detail-hint truncate text-[10px] font-normal text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
