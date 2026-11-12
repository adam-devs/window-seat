import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  Rectangle,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { BoundingBox } from '../types';
import type { Aircraft } from '../data/types';
import {
  createAircraftMotionTracker,
  type AircraftMotionTracker,
} from '../data/motion';
import {
  createAircraftTrailStore,
  type AircraftTrailStore,
} from '../data/trails';
import type { GeoPoint } from '../data/extrapolate';
import { config } from '../config';
import {
  applyMarkerVisual,
  markerVisual,
} from './markerVisuals';
import { formatAltitude, formatSpeed } from '../data/units';
import type { UnitSystem } from '../workspace';
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
  units: UnitSystem;
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
    previous.units === next.units &&
    a.icao24 === b.icao24 &&
    a.callsign === b.callsign &&
    a.origin_country === b.origin_country &&
    a.baro_altitude === b.baro_altitude &&
    a.velocity === b.velocity
  );
}

const AircraftMarker = memo(function AircraftMarker({
  flight,
  selected,
  onSelectFlight,
  registerMarker,
  units,
}: AircraftMarkerProps) {
  // Leaflet position is driven imperatively by the motion loop. Keeping the
  // React `position` prop at its mount value prevents a snapshot from snapping
  // the marker before the correction loop runs.
  const [initialPosition] = useState<[number, number]>(() => [
    flight.latitude,
    flight.longitude,
  ]);
  // The icon DOM is also stable; heading/colour/opacity are updated per frame.
  const [initialIcon] = useState(() =>
    getPlaneIcon(flight.true_track, selected),
  );
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
      icon={initialIcon}
      zIndexOffset={selected ? 1_000 : 0}
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
          ? `Alt: ${formatAltitude(flight.baro_altitude, units)}`
          : 'Altitude: unknown'}
        <br />
        {flight.velocity !== null
          ? `Speed: ${formatSpeed(flight.velocity, units)}`
          : ''}
      </Popup>
    </Marker>
  );
}, aircraftMarkerPropsEqual);

// ---- Sub-component: observed/projected trail lines ----
const OBSERVED_TRAIL_OPTIONS: L.PolylineOptions = {
  className: 'aircraft-trail',
  color: '#3b82f6',
  weight: 2,
  opacity: 0.35,
  interactive: false,
};

const PROJECTED_TRAIL_OPTIONS: L.PolylineOptions = {
  className: 'aircraft-projected-trail',
  color: '#93c5fd',
  weight: 1.5,
  opacity: 0.55,
  dashArray: '4 6',
  interactive: false,
};

interface TrailLineProps {
  icao24: string;
  initial: [number, number];
  options: L.PolylineOptions;
  register: (icao24: string, line: L.Polyline | null) => void;
}

const TrailLine = memo(function TrailLine({
  icao24,
  initial,
  options,
  register,
}: TrailLineProps) {
  // Positions are maintained imperatively. Keeping the React prop stable at
  // mount prevents a re-render from overwriting the animation/trail updates.
  const [positions] = useState<L.LatLngExpression[]>(() => [
    [initial[0], initial[1]],
  ]);
  const setLineRef = useCallback(
    (line: L.Polyline | null) => {
      register(icao24, line);
    },
    [register, icao24],
  );

  return (
    <Polyline ref={setLineRef} positions={positions} pathOptions={options} />
  );
}, (previous, next) =>
  previous.icao24 === next.icao24 &&
  previous.register === next.register &&
  previous.options === next.options);

// ---- Sub-component: fit the map to the active perimeter ----
interface PerimeterFitterProps {
  bbox: BoundingBox | null;
  areaKey: string | null;
  reducedMotion: boolean;
}

function PerimeterFitter({
  bbox,
  areaKey,
  reducedMotion,
}: PerimeterFitterProps) {
  const map = useMap();

  useEffect(() => {
    if (!bbox) return;
    const frame = requestAnimationFrame(() => {
      map.fitBounds(
        [
          [bbox.lamin, bbox.lomin],
          [bbox.lamax, bbox.lomax],
        ],
        {
          padding: [32, 32],
          maxZoom: 12,
          animate: !reducedMotion,
        },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [map, areaKey, reducedMotion]);

  return null;
}

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
  units: UnitSystem;
}

export function FlightMap({
  flights,
  bbox,
  onPerimeterSelected,
  selectedFlight,
  onSelectFlight,
  refreshIntervalMs,
  units,
}: FlightMapProps) {
  const reducedMotion = useReducedMotion();
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef(new Map<string, L.Marker>());
  const glyphRefs = useRef(new Map<string, HTMLElement>());
  const visualKeys = useRef(new Map<string, string>());
  const lastPositions = useRef(new Map<string, GeoPoint>());
  const trailRefs = useRef(new Map<string, L.Polyline>());
  const projectedTrailRefs = useRef(new Map<string, L.Polyline>());
  const trackerRef = useRef<AircraftMotionTracker | null>(null);
  const trailStoreRef = useRef<AircraftTrailStore | null>(null);

  if (trackerRef.current === null) {
    trackerRef.current = createAircraftMotionTracker({ refreshIntervalMs });
  }
  if (trailStoreRef.current === null) {
    trailStoreRef.current = createAircraftTrailStore();
  }

  const registerMarker = useCallback(
    (icao24: string, marker: L.Marker | null) => {
      if (marker) {
        markerRefs.current.set(icao24, marker);
      } else {
        markerRefs.current.delete(icao24);
        glyphRefs.current.delete(icao24);
        visualKeys.current.delete(icao24);
        lastPositions.current.delete(icao24);
      }
    },
    [],
  );

  const registerTrail = useCallback(
    (icao24: string, line: L.Polyline | null) => {
      if (line) trailRefs.current.set(icao24, line);
      else trailRefs.current.delete(icao24);
    },
    [],
  );

  const registerProjectedTrail = useCallback(
    (icao24: string, line: L.Polyline | null) => {
      if (line) projectedTrailRefs.current.set(icao24, line);
      else projectedTrailRefs.current.delete(icao24);
    },
    [],
  );

  const areaKey = bbox
    ? `${bbox.lamin}:${bbox.lomin}:${bbox.lamax}:${bbox.lomax}`
    : null;

  useEffect(() => {
    // A new area starts a fresh history; stale lines are cleared before the
    // first snapshot for the new perimeter arrives.
    trailStoreRef.current!.reset();
    for (const line of trailRefs.current.values()) line.setLatLngs([]);
    for (const line of projectedTrailRefs.current.values()) line.setLatLngs([]);
  }, [areaKey]);

  useEffect(() => {
    trackerRef.current!.setOptions({ refreshIntervalMs });
  }, [refreshIntervalMs]);

  useEffect(() => {
    const tracker = trackerRef.current!;
    const trailStore = trailStoreRef.current!;
    const now = Date.now();
    trailStore.record(flights, now);
    tracker.sync(flights, now);

    for (const flight of flights) {
      const line = trailRefs.current.get(flight.icao24);
      if (!line) continue;
      line.setLatLngs(
        trailStore
          .getTrail(flight.icao24)
          .map((point) => [point.latitude, point.longitude]),
      );
    }

    if (reducedMotion) {
      // Update only when snapshots arrive; no tweening or frame loop.
      for (const line of projectedTrailRefs.current.values()) {
        line.setLatLngs([]);
      }
      for (const flight of flights) {
        const marker = markerRefs.current.get(flight.icao24);
        if (!marker) continue;
        marker.setLatLng([flight.latitude, flight.longitude]);
        lastPositions.current.set(flight.icao24, {
          latitude: flight.latitude,
          longitude: flight.longitude,
        });
        applyVisual(flight, marker, flight.true_track, now);
      }
      return;
    }

    const flightsById = new Map(
      flights.map((flight) => [flight.icao24, flight]),
    );

    let frame = 0;
    let lastUpdateAt = 0;
    let lastProjectedAt = 0;
    let lastVisualAt = 0;
    const tick = (): void => {
      const frameNow = Date.now();
      const zoom = mapRef.current?.getZoom() ?? 7;
      const updateInterval =
        zoom >= 13
          ? 33
          : zoom >= 11
            ? 60
            : zoom >= 10
              ? 100
              : zoom >= 9
                ? 200
                : 1500;

      // Heading/colour/stale updates stay responsive even when position
      // updates are throttled at low zoom. Unchanged visuals are skipped by the
      // key cache in applyVisual.
      if (frameNow - lastVisualAt >= 250) {
        lastVisualAt = frameNow;
        for (const [icao24, marker] of markerRefs.current) {
          const flight = flightsById.get(icao24);
          if (!flight) continue;
          applyVisual(
            flight,
            marker,
            tracker.headingAt(icao24, frameNow),
            frameNow,
          );
        }
      }

      if (frameNow - lastUpdateAt < updateInterval) {
        frame = requestAnimationFrame(tick);
        return;
      }
      lastUpdateAt = frameNow;

      const updateProjected = frameNow - lastProjectedAt >= 250;
      if (updateProjected) lastProjectedAt = frameNow;

      const degreesPerPixel = 360 / (256 * Math.pow(2, zoom));
      const movementThreshold = degreesPerPixel * 0.15;

      for (const [icao24, marker] of markerRefs.current) {
        const flight = flightsById.get(icao24);
        if (!flight) continue;

        const position = tracker.positionAt(icao24, frameNow);
        if (!position) continue;

        const previous = lastPositions.current.get(icao24);
        const longitudeThreshold =
          movementThreshold *
          Math.max(
            0.1,
            Math.cos((position.latitude * Math.PI) / 180),
          );
        const moved =
          !previous ||
          Math.abs(previous.latitude - position.latitude) >=
            movementThreshold ||
          Math.abs(previous.longitude - position.longitude) >=
            longitudeThreshold;

        if (moved) {
          marker.setLatLng([position.latitude, position.longitude]);
          lastPositions.current.set(icao24, position);
        }

        if (moved && updateProjected) {
          const projectedLine = projectedTrailRefs.current.get(icao24);
          const lastObserved = trailStore.lastObserved(icao24);
          if (projectedLine && lastObserved) {
            projectedLine.setLatLngs([
              [lastObserved.latitude, lastObserved.longitude],
              [position.latitude, position.longitude],
            ]);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);

    function applyVisual(
      flight: Aircraft,
      marker: L.Marker,
      heading: number | null,
      atMs: number,
    ): void {
      let glyph = glyphRefs.current.get(flight.icao24);
      if (!glyph) {
        const element = marker.getElement();
        const found =
          element?.querySelector<HTMLElement>('.plane-glyph') ?? null;
        if (!found) return;
        glyph = found;
        glyphRefs.current.set(flight.icao24, found);
      }

      const visual = markerVisual(
        flight,
        atMs,
        flight.icao24 === selectedFlight,
        config.staleAfterMs,
      );
      const key = `${visual.color}|${visual.opacity}|${visual.scale}|${
        heading === null ? 'null' : Math.round(heading * 2) / 2
      }`;
      if (visualKeys.current.get(flight.icao24) === key) return;
      visualKeys.current.set(flight.icao24, key);

      applyMarkerVisual(glyph, heading, visual);
    }
  }, [flights, reducedMotion, selectedFlight]);

  return (
    <MapContainer
      ref={mapRef}
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

      <PerimeterFitter
        bbox={bbox}
        areaKey={areaKey}
        reducedMotion={reducedMotion}
      />

      <PerimeterDrawer onBoundsSelected={onPerimeterSelected} />

      {/* Observed trails and the dead-reckoned segment */}
      {flights.map((flight) => (
        <TrailLine
          key={`trail:${flight.icao24}`}
          icao24={flight.icao24}
          initial={[flight.latitude, flight.longitude]}
          options={OBSERVED_TRAIL_OPTIONS}
          register={registerTrail}
        />
      ))}
      {flights.map((flight) => (
        <TrailLine
          key={`projected:${flight.icao24}`}
          icao24={flight.icao24}
          initial={[flight.latitude, flight.longitude]}
          options={PROJECTED_TRAIL_OPTIONS}
          register={registerProjectedTrail}
        />
      ))}

      {/* Plane markers */}
      {flights.map((flight) => (
        <AircraftMarker
          key={flight.icao24}
          flight={flight}
          selected={flight.icao24 === selectedFlight}
          onSelectFlight={onSelectFlight}
          registerMarker={registerMarker}
          units={units}
        />
      ))}
    </MapContainer>
  );
}
