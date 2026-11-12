// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FlightPanel } from './FlightPanel';
import type { Aircraft } from '../data/types';
import type { FlightEnrichment } from '../data/flightEnrichment';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getEnrichment: vi.fn(),
    requestEnrichment: vi.fn(),
  },
}));

vi.mock('../hooks/useFlightEnrichment', () => ({
  useFlightEnrichment: () => mockApi,
}));

const flight: Aircraft = {
  icao24: 'abc123',
  callsign: 'EXS1286',
  origin_country: 'United Kingdom',
  lastContactMs: Date.now(),
  lastPositionMs: Date.now(),
  latitude: 51.5,
  longitude: -0.1,
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

const ready: FlightEnrichment = {
  status: 'ready',
  origin: {
    city: 'Almería',
    airportName: 'Almería Airport',
    iata: 'LEI',
    icao: 'LEAM',
    country: 'Spain',
    countryCode: 'ES',
  },
  aircraft: {
    manufacturer: 'Airbus',
    type: 'A321-231',
    icaoType: 'A321',
    registration: 'D-AIAA',
  },
  airline: {
    name: 'Jet2.com',
    icao: 'EXS',
    iata: 'LS',
    country: 'United Kingdom',
  },
  fetchedAt: 1_000,
};

function renderPanel(selectedFlight: string | null = 'abc123') {
  return render(
    <FlightPanel
      flights={[flight]}
      selectedFlight={selectedFlight}
      onSelectFlight={() => {}}
      loading={false}
      error={null}
      lastUpdated={new Date()}
      dataAgeMs={12_000}
      providerName="OpenSky Network"
      hasArea
      status="ready"
      mode="perimeter"
      units="aviation"
    />,
  );
}

afterEach(() => {
  cleanup();
  mockApi.getEnrichment.mockReset();
  mockApi.requestEnrichment.mockReset();
});

describe('FlightPanel enrichment', () => {
  it('shows an origin flag and route/type detail when metadata is ready', () => {
    mockApi.getEnrichment.mockReturnValue(ready);
    renderPanel();

    expect(screen.getAllByText('🇪🇸').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /From Spain/ })).toBeTruthy();
    expect(screen.getAllByText('Almería').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Almería Airport (LEI / LEAM)')).toBeTruthy();
    expect(screen.getByText('Airbus A321-231')).toBeTruthy();
    expect(screen.getByText('ICAO type A321')).toBeTruthy();
    expect(screen.getByText('Jet2.com')).toBeTruthy();
    expect(screen.getByText('EXS / LS · United Kingdom')).toBeTruthy();
    expect(screen.getByText(/Likely scheduled route, airline/)).toBeTruthy();
  });

  it('uses a neutral globe and unavailable states when no route is found', () => {
    mockApi.getEnrichment.mockReturnValue({
      status: 'missing',
      origin: null,
      aircraft: null,
      airline: null,
      fetchedAt: 1_000,
    });
    renderPanel();

    expect(screen.queryByText('🇪🇸')).toBeNull();
    expect(document.querySelector('.row-flag svg')).toBeTruthy();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByText('Jet2.com')).toBeNull();
  });

  it('shows lookup placeholders while metadata is loading', () => {
    mockApi.getEnrichment.mockReturnValue({
      status: 'loading',
      origin: null,
      aircraft: null,
      airline: null,
      fetchedAt: 0,
    });
    renderPanel();

    expect(screen.getAllByText('Looking up…')).toHaveLength(2);
    expect(screen.getByText('Checking scheduled route…')).toBeTruthy();
  });

  it('requests enrichment for rows and the selected aircraft', () => {
    mockApi.getEnrichment.mockReturnValue({
      status: 'idle',
      origin: null,
      aircraft: null,
      airline: null,
      fetchedAt: 0,
    });
    renderPanel();

    expect(mockApi.requestEnrichment).toHaveBeenCalledWith(
      'abc123',
      'EXS1286',
    );
  });
});
