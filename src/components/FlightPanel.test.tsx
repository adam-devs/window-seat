// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FlightPanel } from './FlightPanel';
import type { Aircraft } from '../data/types';
import type { FlightStatus } from '../data/flightStatus';

function aircraft(icao24: string, callsign: string): Aircraft {
  return {
    icao24,
    callsign,
    origin_country: 'Testland',
    lastContactMs: Date.now(),
    lastPositionMs: Date.now(),
    latitude: 51,
    longitude: 0,
    baro_altitude: 10_000,
    geo_altitude: null,
    on_ground: false,
    velocity: 220,
    true_track: 90,
    vertical_rate: 0,
    squawk: '7000',
    spi: false,
    providerId: 'opensky',
  };
}

const flights = [
  aircraft('abc123', 'ABC123'),
  aircraft('def456', 'DEF456'),
];

const updated = new Date(2026, 10, 12, 14, 32, 10);

interface RenderPanelOptions {
  flights?: Aircraft[];
  selectedFlight?: string | null;
  loading?: boolean;
  error?: string | null;
  lastUpdated?: Date | null;
  dataAgeMs?: number | null;
  providerName?: string;
  hasArea?: boolean;
  status?: FlightStatus;
}

function renderPanel(options: RenderPanelOptions = {}) {
  return render(panelElement(options));
}

function panelElement(options: RenderPanelOptions = {}) {
  return (
    <FlightPanel
      flights={options.flights ?? flights}
      selectedFlight={options.selectedFlight ?? null}
      onSelectFlight={() => {}}
      loading={options.loading ?? false}
      error={options.error ?? null}
      lastUpdated={options.lastUpdated ?? null}
      dataAgeMs={options.dataAgeMs ?? 12_000}
      providerName={options.providerName ?? 'OpenSky Network'}
      hasArea={options.hasArea ?? true}
      status={options.status ?? 'ready'}
    />
  );
}

/** Controlled panel so row clicks exercise the real selection flow. */
function SelectionHarness({
  initialFlights = flights,
}: {
  initialFlights?: Aircraft[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <FlightPanel
      flights={initialFlights}
      selectedFlight={selected}
      onSelectFlight={setSelected}
      loading={false}
      error={null}
      lastUpdated={updated}
      dataAgeMs={12_000}
      providerName="OpenSky Network"
      hasArea
      status="ready"
    />
  );
}

afterEach(cleanup);

describe('FlightPanel', () => {
  it('keeps rows and the count visible during a background refresh', () => {
    renderPanel({
      loading: true,
      status: 'refreshing',
      lastUpdated: updated,
    });

    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('DEF456')).toBeTruthy();
    expect(screen.getByText('2 aircraft in area')).toBeTruthy();
    // The header keeps the last update age and appends the refresh.
    expect(screen.getByText('Updated 12s ago · Refreshing…')).toBeTruthy();
    expect(screen.getByText('via OpenSky Network')).toBeTruthy();
    expect(screen.queryByText('Loading nearby flights…')).toBeNull();
    expect(
      screen.getByLabelText('Nearby aircraft').getAttribute('aria-busy'),
    ).toBe('true');
    // A background refresh must not replace the list with a loading message.
    expect(screen.queryByText('Loading nearby aircraft…')).toBeNull();
  });

  it('keeps last-good rows and the selected detail card through a failure', () => {
    renderPanel({
      selectedFlight: 'abc123',
      error: 'OpenSky server error (503)',
      status: 'error',
      lastUpdated: updated,
    });

    // Both the list row and the detail card still show the selected aircraft.
    expect(screen.getAllByText('ABC123').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('DEF456')).toBeTruthy();
    expect(screen.getByText('ICAO24')).toBeTruthy();
    expect(screen.getByText('OpenSky server error (503)')).toBeTruthy();
    expect(screen.getByText('Updated 12s ago · Refresh failed')).toBeTruthy();
    expect(screen.getByText('2 aircraft in area')).toBeTruthy();
  });

  it('shows the loading message only for an empty first load', () => {
    renderPanel({ flights: [], loading: true, status: 'loading' });

    expect(screen.getByText('Loading nearby aircraft…')).toBeTruthy();
    expect(screen.getByText('Loading nearby flights…')).toBeTruthy();
    expect(screen.queryByText(/No airborne aircraft/)).toBeNull();
  });

  it('does not claim the area is empty after a first-load failure', () => {
    renderPanel({
      flights: [],
      error: 'Network request failed',
      status: 'error',
    });

    expect(
      screen.getByText(
        'Couldn’t load aircraft for this area. Retrying automatically.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No airborne aircraft/)).toBeNull();
  });

  it('shows an empty-area message only after data arrives', () => {
    renderPanel({ flights: [], status: 'ready', lastUpdated: updated });

    expect(
      screen.getByText('No airborne aircraft in this area right now.'),
    ).toBeTruthy();
    expect(screen.getByText('Updated 12s ago')).toBeTruthy();
    expect(screen.getByText('Updated 12s ago').getAttribute('title')).toBe(
      'Updated at 14:32:10',
    );
  });

  it('prompts for an area when none is selected', () => {
    renderPanel({ flights: [], hasArea: false, status: 'idle' });

    expect(
      screen.getByText('Set a search area on the map to begin tracking.'),
    ).toBeTruthy();
    expect(screen.getByText('No area selected')).toBeTruthy();
  });

  it('selects a row, highlights it, and opens the detail card', () => {
    render(<SelectionHarness />);

    const row = screen.getByText('ABC123').closest('.flight-row');
    expect(row).not.toBeNull();
    expect(row!.className).not.toContain('active');
    expect(screen.queryByText('ICAO24')).toBeNull();

    fireEvent.click(row!);

    expect(row!.className).toContain('active');
    expect(screen.getByText('ICAO24')).toBeTruthy();
    // Row callsign, detail-card callsign, and the ICAO24 detail value.
    expect(screen.getAllByText('ABC123')).toHaveLength(3);

    fireEvent.click(
      screen.getByRole('button', { name: 'Close flight details' }),
    );

    expect(screen.queryByText('ICAO24')).toBeNull();
    expect(row!.className).not.toContain('active');
  });

  it('toggles the same row off when clicked again', () => {
    render(<SelectionHarness />);

    const row = screen.getByText('DEF456').closest('.flight-row')!;
    fireEvent.click(row);
    expect(screen.getByText('ICAO24')).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByText('ICAO24')).toBeNull();
  });

  it('renders the selected flight details with the expected formatting', () => {
    const detailed: Aircraft = {
      ...aircraft('abc123', 'SWA123'),
      origin_country: 'United States',
      baro_altitude: 10_000,
      velocity: 220,
      vertical_rate: 2.5,
      true_track: 90,
      squawk: '4321',
    };

    render(<SelectionHarness initialFlights={[detailed]} />);
    fireEvent.click(screen.getByText('SWA123').closest('.flight-row')!);

    expect(screen.getByText('ABC123')).toBeTruthy();
    // Country appears in both the selected row and the detail card.
    expect(screen.getAllByText('United States')).toHaveLength(2);
    // Altitude and speed appear in both the row and the detail card.
    expect(screen.getAllByText('32,808 ft')).toHaveLength(2);
    expect(screen.getAllByText('428 kts')).toHaveLength(2);
    expect(screen.getByText('+492 fpm')).toBeTruthy();
    expect(screen.getByText('90°')).toBeTruthy();
    expect(screen.getByText('4321')).toBeTruthy();
    expect(screen.getByText('Airborne')).toBeTruthy();
    expect(
      screen
        .getByText('View on FlightRadar24 ↗')
        .getAttribute('href'),
    ).toBe('https://www.flightradar24.com/SWA123');
  });

  it('counts only airborne aircraft and ignores on-ground rows', () => {
    const onGround: Aircraft = {
      ...aircraft('gnd001', 'GND1'),
      on_ground: true,
    };

    renderPanel({
      flights: [...flights, onGround],
      loading: true,
      status: 'refreshing',
      lastUpdated: updated,
    });

    expect(screen.getByText('2 aircraft in area')).toBeTruthy();
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('DEF456')).toBeTruthy();
    expect(screen.queryByText('GND1')).toBeNull();
  });

  it('keeps a selected row and its card through a background refresh', () => {
    const initial = renderPanel({
      selectedFlight: 'abc123',
      lastUpdated: updated,
    });

    expect(
      screen.getByText('ABC123', { selector: '.row-callsign' }).closest(
        '.flight-row',
      )!.className,
    ).toContain('active');
    expect(screen.getByText('ICAO24')).toBeTruthy();

    initial.rerender(
      panelElement({
        flights,
        selectedFlight: 'abc123',
        loading: true,
        status: 'refreshing',
        lastUpdated: updated,
      }),
    );

    expect(
      screen.getByText('ABC123', { selector: '.row-callsign' }).closest(
        '.flight-row',
      )!.className,
    ).toContain('active');
    expect(screen.getByText('ICAO24')).toBeTruthy();
    expect(screen.getByText('2 aircraft in area')).toBeTruthy();
  });
});
