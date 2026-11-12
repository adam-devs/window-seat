import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Rectangle,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { BoundingBox } from '../types';
import type { Aircraft } from '../data/types';
import {
  createAircraftMotionTracker,
  type AircraftMotionTracker,
} from '../data/motion';
import type { GeoPoint } from '../data/extrapolate';
import { msToKnots, mToFeet } from '../utils/opensky';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { getPlaneIcon } from './mapIcons';

// Fix Leaflet's default icon path issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ---- Sub-component: one aircraft marker ----
interface AircraftMarkerProps {
  flight: Aircraft;
  selected: boolean;
  onSelectFlight: (icao24: string | null) => void;
  registerMarker: (icao24: string, marker: L.Marker | null) => void;
}

function aircraftMarkerPropsEqual(
  previous: AircraftMarkerProps,
  next: AircraftMarkerProps,
): boolean {
  const a = previous.flight;
  const b = next.flight;
  return (
    previous.selected === next.selected &&
    previous.onSelectFlight === next.onSelectFlight &&
    previous.registerMarker === next.registerMarker &&
    a.icao24 === b.icao24 &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.callsign === b.callsign &&
    a.origin_country === b.origin_country &&
    a.baro_altitude === b.baro_altitude &&
    a.velocity === b.velocity &&
    a.true_track === b.true_track
  );
}

const AircraftMarker = memo(function AircraftMarker({
  flight,
  selected,
  onSelectFlight,
  registerMarker,
}: AircraftMarkerProps) {
  // Leaflet position is driven imperatively by the motion loop. Keeping the
  // React `position` prop at its mount value prevents a snapshot from snapping
  // the marker before the correction loop runs.
  const [initialPosition] = useState<[number, number]>(() => [
    flight.latitude,
    flight.longitude,
  ]);
  const setMarkerRef = useCallback(
    (marker: L.Marker | null) => {
      registerMarker(flight.icao24, marker);
    },
    [registerMarker, flight.icao24],
  );

  return (
    <Marker
      ref={setMarkerRef}
      position={initialPosition}
      icon={getPlaneIcon(flight.true_track, selected)}
      eventHandlers={{
        click: () =>
          onSelectFlight(selected ? null : flight.icao24),
      }}
    >
      <Popup>
        <strong>{flight.callsign ?? 'Unknown callsign'}</strong>
        <br />
        {flight.origin_country ?? 'Unknown country'}
        <br />
        {flight.baro_altitude !== null
          ? `Alt: ${mToFeet(flight.baro_altitude).toLocaleString()} ft`
          : 'Altitude: unknown'}
        <br />
        {flight.velocity !== null
          ? `Speed: ${msToKnots(flight.velocity)} kts`
          : ''}
      </Popup>
    </Marker>
  );
}, aircraftMarkerPropsEqual);

// ---- Sub-component: handles map clicks for perimeter drawing ----
interface PerimeterDrawerProps {
  onBoundsSelected: (bbox: BoundingBox) => void;
}

function PerimeterDrawer({ onBoundsSelected }: PerimeterDrawerProps) {
  const [corner1, setCorner1] = useState<L.LatLng | null>(null);

  useMapEvents({
    click(e) {
      if (!corner1) {
        setCorner1(e.latlng);
      } else {
        const bbox: BoundingBox = {
          lamin: Math.min(corner1.lat, e.latlng.lat),
          lamax: Math.max(corner1.lat, e.latlng.lat),
          lomin: Math.min(corner1.lng, e.latlng.lng),
          lomax: Math.max(corner1.lng, e.latlng.lng),
        };
        onBoundsSelected(bbox);
        setCorner1(null);
      }
    },
  });

  return corner1 ? (
    <Marker
      position={corner1}
      icon={L.divIcon({ className: '', html: '<div style="width:10px;height:10px;background:#f59e0b;border-radius:50%;border:2px solid white"></div>', iconAnchor: [5, 5] })}
    />
  ) : null;
}

// ---- Main FlightMap ----
interface FlightMapProps {
  flights: Aircraft[];
  bbox: BoundingBox | null;
  onPerimeterSelected: (bbox: BoundingBox) => void;
  selectedFlight: string | null;
  onSelectFlight: (icao24: string | null) => void;
  /** Current user cadence; tightens the dead-reckoning cap. */
  refreshIntervalMs: number;
}

const POSITION_EPSILON = 1e-9;

export function FlightMap({
  flights,
  bbox,
  onPerimeterSelected,
  selectedFlight,
  onSelectFlight,
  refreshIntervalMs,
}: FlightMapProps) {
  const reducedMotion = useReducedMotion();
  const markerRefs = useRef(new Map<string, L.Marker>());
  const lastPositions = useRef(new Map<string, GeoPoint>());
  const trackerRef = useRef<AircraftMotionTracker | null>(null);

  if (trackerRef.current === null) {
    trackerRef.current = createAircraftMotionTracker({ refreshIntervalMs });
  }

  const registerMarker = useCallback(
    (icao24: string, marker: L.Marker | null) => {
      if (marker) {
        markerRefs.current.set(icao24, marker);
      } else {
        markerRefs.current.delete(icao24);
        lastPositions.current.delete(icao24);
      }
    },
    [],
  );

  useEffect(() => {
    trackerRef.current!.setOptions({ refreshIntervalMs });
  }, [refreshIntervalMs]);

  useEffect(() => {
    const tracker = trackerRef.current!;
    tracker.sync(flights, Date.now());

    if (reducedMotion) {
      // Update only when snapshots arrive; no tweening or frame loop.
      for (const flight of flights) {
        const marker = markerRefs.current.get(flight.icao24);
        if (!marker) continue;
        marker.setLatLng([flight.latitude, flight.longitude]);
        lastPositions.current.set(flight.icao24, {
          latitude: flight.latitude,
          longitude: flight.longitude,
        });
      }
      return;
    }

    let frame = 0;
    const tick = (): void => {
      const now = Date.now();
      for (const [icao24, marker] of markerRefs.current) {
        const position = tracker.positionAt(icao24, now);
        if (!position) continue;

        const previous = lastPositions.current.get(icao24);
        if (
          previous &&
          Math.abs(previous.latitude - position.latitude) < POSITION_EPSILON &&
          Math.abs(previous.longitude - position.longitude) < POSITION_EPSILON
        ) {
          continue;
        }

        marker.setLatLng([position.latitude, position.longitude]);
        lastPositions.current.set(icao24, position);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flights, reducedMotion]);

  return (
    <MapContainer
      center={[51.5, -0.1]}
      zoom={7}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Draw the active perimeter */}
      {bbox && (
        <Rectangle
          bounds={[[bbox.lamin, bbox.lomin], [bbox.lamax, bbox.lomax]]}
          pathOptions={{ color: '#3b82f6', fillOpacity: 0.05, weight: 1.5 }}
        />
      )}

      <PerimeterDrawer onBoundsSelected={onPerimeterSelected} />

      {/* Plane markers */}
      {flights.map((flight) => (
        <AircraftMarker
          key={flight.icao24}
          flight={flight}
          selected={flight.icao24 === selectedFlight}
          onSelectFlight={onSelectFlight}
          registerMarker={registerMarker}
        />
      ))}
    </MapContainer>
  );
}
