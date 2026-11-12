import { describe, expect, it } from 'vitest';
import {
  aircraftTypeLabel,
  airlineCodeLabel,
  airlineNameLabel,
  countryCodeToFlag,
  enrichmentKey,
  originAirportLabel,
  originCityLabel,
  originCodeLabel,
  parseFlightEnrichment,
} from './flightEnrichment';

const payload = {
  response: {
    aircraft: {
      type: 'A321-231',
      icao_type: 'A321',
      manufacturer: 'Airbus',
      mode_s: '3FF6C7',
      registration: 'D-AIAA',
    },
    flightroute: {
      callsign: 'EXS1286',
      callsign_icao: 'EXS1286',
      airline: {
        name: 'Jet2.com',
        icao: 'EXS',
        iata: 'LS',
        country: 'United Kingdom',
        country_iso: 'GB',
      },
      origin: {
        country_iso_name: 'ES',
        country_name: 'Spain',
        iata_code: 'LEI',
        icao_code: 'LEAM',
        municipality: 'Almería',
        name: 'Almería Airport',
      },
      destination: {
        country_iso_name: 'GB',
        country_name: 'United Kingdom',
        iata_code: 'BHX',
        icao_code: 'EGBB',
        municipality: 'Birmingham',
        name: 'Birmingham International Airport',
      },
    },
  },
};

describe('parseFlightEnrichment', () => {
  it('parses origin and aircraft data from the combined response', () => {
    const result = parseFlightEnrichment(payload, 1234);

    expect(result).toMatchObject({
      status: 'ready',
      fetchedAt: 1234,
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
    });
  });

  it('accepts a top-level origin and a type-only response', () => {
    const withTopLevelOrigin = parseFlightEnrichment({
      response: {
        origin: { municipality: 'Paris', icao_code: 'LFPG' },
      },
    });
    expect(withTopLevelOrigin?.origin?.city).toBe('Paris');

    const typeOnly = parseFlightEnrichment({
      response: { aircraft: { icao_type: 'B738' } },
    });
    expect(typeOnly?.origin).toBeNull();
    expect(typeOnly?.aircraft?.icaoType).toBe('B738');

    const airlineOnly = parseFlightEnrichment({
      response: {
        flightroute: {
          airline: { name: 'Wizz Air', icao: 'WZZ', iata: 'W6' },
        },
      },
    });
    expect(airlineOnly?.origin).toBeNull();
    expect(airlineOnly?.aircraft).toBeNull();
    expect(airlineOnly?.airline?.name).toBe('Wizz Air');
  });

  it('returns null when neither aircraft nor origin is usable', () => {
    expect(parseFlightEnrichment(null)).toBeNull();
    expect(parseFlightEnrichment({ response: {} })).toBeNull();
    expect(parseFlightEnrichment({ response: { aircraft: {} } })).toBeNull();
  });

  it('trims whitespace and normalizes country codes', () => {
    const result = parseFlightEnrichment({
      response: {
        aircraft: { type: '  A320  ', manufacturer: ' Airbus ' },
        flightroute: {
          origin: { municipality: ' London ', country_iso_name: 'gb' },
        },
      },
    });
    expect(result?.aircraft?.type).toBe('A320');
    expect(result?.aircraft?.manufacturer).toBe('Airbus');
    expect(result?.origin?.city).toBe('London');
    expect(result?.origin?.countryCode).toBe('GB');
  });
});

describe('countryCodeToFlag', () => {
  it('converts ISO alpha-2 codes to regional-indicator flags', () => {
    expect(countryCodeToFlag('GB')).toBe('🇬🇧');
    expect(countryCodeToFlag('es')).toBe('🇪🇸');
    expect(countryCodeToFlag(' XK ')).toBe('🇽🇰');
  });

  it('rejects invalid country codes', () => {
    expect(countryCodeToFlag('')).toBeNull();
    expect(countryCodeToFlag('GBR')).toBeNull();
    expect(countryCodeToFlag('1A')).toBeNull();
    expect(countryCodeToFlag(null)).toBeNull();
  });
});

describe('enrichment labels', () => {
  const origin = {
    city: 'Almería',
    airportName: 'Almería Airport',
    iata: 'LEI',
    icao: 'LEAM',
    country: 'Spain',
    countryCode: 'ES',
  };
  const aircraft = {
    manufacturer: 'Airbus',
    type: 'A321-231',
    icaoType: 'A321',
    registration: 'D-AIAA',
  };

  it('formats origin labels with sensible fallbacks', () => {
    expect(originCityLabel(origin)).toBe('Almería');
    expect(originCodeLabel(origin)).toBe('LEI / LEAM');
    expect(originAirportLabel(origin)).toBe('Almería Airport (LEI / LEAM)');
    expect(originCityLabel(null)).toBeNull();
    expect(originAirportLabel(null)).toBeNull();
  });

  it('formats aircraft type labels with manufacturer and fallback code', () => {
    expect(aircraftTypeLabel(aircraft)).toBe('Airbus A321-231');
    expect(
      aircraftTypeLabel({ ...aircraft, manufacturer: null, type: null }),
    ).toBe('A321');
    expect(aircraftTypeLabel(null)).toBeNull();
  });

  it('formats airline labels and codes', () => {
    expect(
      airlineNameLabel({
        name: 'Jet2.com',
        icao: 'EXS',
        iata: 'LS',
        country: 'United Kingdom',
      }),
    ).toBe('Jet2.com');
    expect(
      airlineCodeLabel({
        name: 'Jet2.com',
        icao: 'EXS',
        iata: 'LS',
        country: 'United Kingdom',
      }),
    ).toBe('EXS / LS');
    expect(airlineNameLabel(null)).toBeNull();
    expect(airlineCodeLabel(null)).toBeNull();
  });

  it('builds stable keys', () => {
    expect(enrichmentKey('ABC123', ' exs1286 ')).toBe('abc123:EXS1286');
    expect(enrichmentKey('abc123', null)).toBe('abc123:');
  });
});
