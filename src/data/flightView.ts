import type { Aircraft } from './types';

/**
 * Pure list-view options for the flight panel.
 *
 * Filtering and sorting stay outside React so the behavior is easy to test and
 * the component only decides how to present the result.
 */

export type FlightSort =
  | 'callsign'
  | 'altitude-desc'
  | 'speed-desc'
  | 'vertical-desc'
  | 'contact-desc';

export type FlightFilter = 'airborne' | 'on-ground' | 'all';

export interface FlightViewOptions {
  query: string;
  sort: FlightSort;
  filter: FlightFilter;
}

export const DEFAULT_FLIGHT_VIEW: FlightViewOptions = {
  query: '',
  sort: 'callsign',
  filter: 'airborne',
};

function normalizedQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesFilter(flight: Aircraft, filter: FlightFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'on-ground' ? flight.on_ground : !flight.on_ground;
}

function matchesQuery(flight: Aircraft, query: string): boolean {
  if (!query) return true;
  if ((flight.callsign ?? '').toLowerCase().includes(query)) return true;
  return flight.icao24.toLowerCase().includes(query);
}

function altitude(flight: Aircraft): number {
  return flight.baro_altitude ?? flight.geo_altitude ?? Number.NEGATIVE_INFINITY;
}

function compareValues(
  a: Aircraft,
  b: Aircraft,
  value: (flight: Aircraft) => number,
): number {
  const difference = value(b) - value(a);
  return difference === 0 ? a.icao24.localeCompare(b.icao24) : difference;
}

function compareCallsign(a: Aircraft, b: Aircraft): number {
  const aCallsign = a.callsign?.trim() ?? '';
  const bCallsign = b.callsign?.trim() ?? '';
  if (!aCallsign && bCallsign) return 1;
  if (aCallsign && !bCallsign) return -1;
  const byCallsign = aCallsign.localeCompare(bCallsign, undefined, {
    sensitivity: 'base',
  });
  return byCallsign === 0 ? a.icao24.localeCompare(b.icao24) : byCallsign;
}

function sortFlights(flights: Aircraft[], sort: FlightSort): Aircraft[] {
  const copy = [...flights];
  switch (sort) {
    case 'altitude-desc':
      return copy.sort((a, b) => compareValues(a, b, altitude));
    case 'speed-desc':
      return copy.sort((a, b) =>
        compareValues(a, b, (flight) => flight.velocity ?? Number.NEGATIVE_INFINITY),
      );
    case 'vertical-desc':
      return copy.sort((a, b) =>
        compareValues(
          a,
          b,
          (flight) => flight.vertical_rate ?? Number.NEGATIVE_INFINITY,
        ),
      );
    case 'contact-desc':
      return copy.sort((a, b) => compareValues(a, b, (flight) => flight.lastContactMs));
    case 'callsign':
      return copy.sort(compareCallsign);
  }
}

/** Apply the panel's status filter, text search, and sort order. */
export function filterAndSortFlights(
  flights: Aircraft[],
  options: FlightViewOptions = DEFAULT_FLIGHT_VIEW,
): Aircraft[] {
  const query = normalizedQuery(options.query);
  const filtered = flights.filter(
    (flight) =>
      matchesFilter(flight, options.filter) && matchesQuery(flight, query),
  );
  return sortFlights(filtered, options.sort);
}
