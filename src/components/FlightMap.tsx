import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  Rectangle,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { BoundingBox, SelectionMode } from '../types';
import type { Aircraft } from '../data/types';
import {
  createAircraftMotionTracker,
  type AircraftMotionTracker,
} from '../data/motion';
import {
  createAircraftTrailStore,
  type AircraftTrailStore,
} from '../data/trails';
import { destinationPoint, type GeoPoint } from '../data/extrapolate';
import { coneBoundingBox, conePolygon } from '../data/direction';
import {
  selectionFromPoints,
  type DirectionalOrigin,
  type DirectionalSelection,
} from '../data/directionalView';
import { bboxKey } from '../data/selectionArea';
import { config } from '../config';
import {
  applyMarkerVisual,
  markerVisual,
  markerZoomScale,
} from './markerVisuals';
import { formatAltitude, formatSpeed } from '../data/units';
import type { UnitSystem } from '../workspace';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  DARK_MODE_QUERY,
  useMediaQuery,
} from '../hooks/useMediaQuery';
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

const CONE_OPTIONS: L.PathOptions = {
  className: 'view-cone',
  color: '#f59e0b',
  weight: 1.5,
  opacity: 0.8,
  fillColor: '#f59e0b',
  fillOpacity: 0.12,
  interactive: false,
};

const BEARING_LINE_OPTIONS: L.PolylineOptions = {
  className: 'view-bearing-line',
  color: '#f59e0b',
  weight: 2,
  opacity: 0.85,
  dashArray: '6 4',
  interactive: false,
};

const MAP_TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

// ---- Sub-component: keep Leaflet sized to its container ----
function MapResizer() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const invalidate = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false, pan: false });
      });
    };

    // The flex layout can settle after Leaflet's initial measurement.
    invalidate();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', invalidate);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', invalidate);
      };
    }

    const observer = new ResizeObserver(invalidate);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

// ---- Sub-component: keyboard instructions and map labelling ----
interface MapAccessibilityProps {
  mode: SelectionMode;
  hasPendingOrigin: boolean;
}

function MapAccessibility({
  mode,
  hasPendingOrigin,
}: MapAccessibilityProps) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const label =
      mode === 'perimeter'
        ? 'Map for drawing a perimeter'
        : hasPendingOrigin
          ? 'Map for aiming a view'
          : 'Map for pinning a view';
    container.setAttribute('aria-label', label);
    container.setAttribute('aria-roledescription', 'interactive map');
    container.setAttribute(
      'aria-keyshortcuts',
      'ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape',
    );
    container.setAttribute('aria-describedby', 'map-keyboard-instructions');
  }, [map, mode, hasPendingOrigin]);

  return null;
}

// ---- Sub-component: fit the map to the active perimeter ----
interface PerimeterFitterProps {
  bbox: BoundingBox | null;
  areaKey: string | null;
  reducedMotion: boolean;
  fitToken: number;
}

function PerimeterFitter({
  bbox,
  areaKey,
  reducedMotion,
  fitToken,
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
  }, [map, areaKey, reducedMotion, fitToken]);

  return null;
}

// ---- Sub-component: fit the map to the active View cone ----
interface DirectionFitterProps {
  direction: DirectionalSelection | null;
  reducedMotion: boolean;
  fitToken: number;
}

function DirectionFitter({
  direction,
  reducedMotion,
  fitToken,
}: DirectionFitterProps) {
  const map = useMap();
  const areaKey = direction
    ? `${direction.origin.latitude}:${direction.origin.longitude}:${direction.bearingDeg}:${direction.angleDeg}:${direction.visibilityKm}`
    : null;

  useEffect(() => {
    if (!direction) return;
    const bbox = coneBoundingBox(
      direction.origin,
      direction.bearingDeg,
      direction.angleDeg,
      direction.visibilityKm,
    );
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
  }, [map, areaKey, reducedMotion, fitToken]);

  return null;
}

// ---- Sub-component: handles map clicks for perimeter drawing ----
interface PerimeterDrawerProps {
  onBoundsSelected: (bbox: BoundingBox) => void;
}

function PerimeterDrawer({ onBoundsSelected }: PerimeterDrawerProps) {
  const map = useMap();
  const [corner1, setCorner1] = useState<L.LatLng | null>(null);

  const selectPoint = useCallback(
    (point: L.LatLng) => {
      if (!corner1) {
        setCorner1(point);
        return;
      }
      const bbox: BoundingBox = {
        lamin: Math.min(corner1.lat, point.lat),
        lamax: Math.max(corner1.lat, point.lat),
        lomin: Math.min(corner1.lng, point.lng),
        lomax: Math.max(corner1.lng, point.lng),
      };
      onBoundsSelected(bbox);
      setCorner1(null);
    },
    [corner1, onBoundsSelected],
  );

  useMapEvents({
    click(e) {
      selectPoint(e.latlng);
    },
  });

  // Keyboard equivalent: arrow keys pan the Leaflet map; Enter places a
  // corner at the current centre. Escape cancels an uncommitted corner.
  useEffect(() => {
    const container = map.getContainer();
    function handleKeyDown(event: KeyboardEvent): void {
      // Only the map itself owns these keys; links inside attribution or a
      // popup must keep their normal Enter behavior.
      if (event.target !== container) return;
      if (event.key === 'Escape' && corner1) {
        event.preventDefault();
        setCorner1(null);
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      selectPoint(map.getCenter());
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [map, selectPoint, corner1]);

  return corner1 ? (
    <Marker
      position={corner1}
      icon={L.divIcon({ className: '', html: '<div style="width:10px;height:10px;background:#f59e0b;border-radius:50%;border:2px solid white"></div>', iconAnchor: [5, 5] })}
    />
  ) : null;
}

// ---- Sub-component: pin an origin, then aim the View cone ----
const VIEW_ORIGIN_ICON = L.divIcon({
  className: '',
  html: '<div class="view-origin" aria-hidden="true"></div>',
  iconAnchor: [8, 8],
});

interface DirectionPickerProps {
  direction: DirectionalSelection | null;
  pendingOrigin: DirectionalOrigin | null;
  onPendingOriginChange: (origin: DirectionalOrigin | null) => void;
  onDirectionChange: (direction: DirectionalSelection | null) => void;
}

function DirectionPicker({
  direction,
  pendingOrigin,
  onPendingOriginChange,
  onDirectionChange,
}: DirectionPickerProps) {
  const map = useMap();
  // Keep the last cone shape so re-pinning preserves the angle/distance while
  // the direction itself is temporarily cleared for the bearing step.
  const lastOptions = useRef<
    Pick<DirectionalSelection, 'angleDeg' | 'visibilityKm'> | null
  >(null);
  if (direction) {
    lastOptions.current = {
      angleDeg: direction.angleDeg,
      visibilityKm: direction.visibilityKm,
    };
  }

  const selectPoint = useCallback(
    (point: DirectionalOrigin) => {
      if (!pendingOrigin) {
        if (direction) onDirectionChange(null);
        onPendingOriginChange(point);
        return;
      }

      const next = selectionFromPoints(
        pendingOrigin,
        point,
        lastOptions.current ?? undefined,
      );
      if (!next) return;

      onPendingOriginChange(null);
      onDirectionChange(next);
    },
    [
      pendingOrigin,
      direction,
      onDirectionChange,
      onPendingOriginChange,
    ],
  );

  useMapEvents({
    click(event) {
      selectPoint({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    },
  });

  // Keyboard equivalent: Enter pins the origin or aims the cone at the map
  // centre. Escape discards an uncommitted origin.
  useEffect(() => {
    const container = map.getContainer();
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.target !== container) return;
      if (event.key === 'Escape' && pendingOrigin) {
        event.preventDefault();
        onPendingOriginChange(null);
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const centre = map.getCenter();
      selectPoint({
        latitude: centre.lat,
        longitude: centre.lng,
      });
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [map, selectPoint, pendingOrigin, onPendingOriginChange]);

  const origin = pendingOrigin ?? direction?.origin ?? null;
  if (!origin) return null;

  return (
    <Marker
      position={[origin.latitude, origin.longitude]}
      icon={VIEW_ORIGIN_ICON}
      draggable
      zIndexOffset={900}
      eventHandlers={{
        dragend(event) {
          const latlng = (event.target as L.Marker).getLatLng();
          // Moving the pin restarts the bearing step; the next click aims it.
          if (direction) onDirectionChange(null);
          onPendingOriginChange({
            latitude: latlng.lat,
            longitude: latlng.lng,
          });
        },
      }}
    />
  );
}

// ---- Main FlightMap ----
interface FlightMapProps {
  flights: Aircraft[];
  /** Active provider query area; a change resets trail history. */
  bbox: BoundingBox | null;
  /** Last perimeter; only drawn and fitted in Perimeter mode. */
  perimeter: BoundingBox | null;
  mode: SelectionMode;
  direction: DirectionalSelection | null;
  pendingDirectionOrigin: DirectionalOrigin | null;
  onPendingDirectionOriginChange: (origin: DirectionalOrigin | null) => void;
  onDirectionChange: (direction: DirectionalSelection | null) => void;
  onPerimeterSelected: (bbox: BoundingBox) => void;
  selectedFlight: string | null;
  onSelectFlight: (icao24: string | null) => void;
  /** Current user cadence; tightens the dead-reckoning cap. */
  refreshIntervalMs: number;
  /** Increment to re-fit the map even when the selection is unchanged. */
  fitToken: number;
  units: UnitSystem;
}

export function FlightMap({
  flights,
  bbox,
  perimeter,
  mode,
  direction,
  pendingDirectionOrigin,
  onPendingDirectionOriginChange,
  onDirectionChange,
  onPerimeterSelected,
  selectedFlight,
  onSelectFlight,
  refreshIntervalMs,
  fitToken,
  units,
}: FlightMapProps) {
  const reducedMotion = useReducedMotion();
  const prefersDark = useMediaQuery(DARK_MODE_QUERY);
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

  const areaKey = bboxKey(bbox);
  const perimeterKey = bboxKey(perimeter);

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
        applyVisual(
          flight,
          marker,
          flight.true_track,
          now,
          markerZoomScale(mapRef.current?.getZoom() ?? 7),
        );
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
            markerZoomScale(zoom),
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
      zoomScale: number,
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

      applyMarkerVisual(glyph, heading, visual, zoomScale);
    }
  }, [flights, reducedMotion, selectedFlight]);

  const conePositions =
    mode === 'direction' && direction
      ? conePolygon(
          direction.origin,
          direction.bearingDeg,
          direction.angleDeg,
          direction.visibilityKm,
          48,
        ).map(
          (point) =>
            [point.latitude, point.longitude] as [number, number],
        )
      : null;
  const bearingEnd =
    mode === 'direction' && direction
      ? destinationPoint(
          direction.origin,
          direction.bearingDeg,
          direction.visibilityKm * 1_000,
        )
      : null;

  return (
    <MapContainer
      ref={mapRef}
      className={prefersDark ? 'map-dark' : undefined}
      center={[51.5, -0.1]}
      zoom={7}
      style={{ height: '100%', width: '100%' }}
    >
      <MapResizer />
      <MapAccessibility
        mode={mode}
        hasPendingOrigin={pendingDirectionOrigin !== null}
      />

      <TileLayer
        attribution={MAP_TILES.attribution}
        url={MAP_TILES.url}
      />

      {/* The perimeter is only the query shape in Perimeter mode. */}
      {mode === 'perimeter' && perimeter && (
        <Rectangle
          bounds={[
            [perimeter.lamin, perimeter.lomin],
            [perimeter.lamax, perimeter.lomax],
          ]}
          pathOptions={{ color: '#3b82f6', fillOpacity: 0.05, weight: 1.5 }}
        />
      )}

      {/* Translucent cone and centre bearing line for the active View */}
      {conePositions && bearingEnd && direction && (
        <>
          <Polygon positions={conePositions} pathOptions={CONE_OPTIONS} />
          <Polyline
            positions={[
              [direction.origin.latitude, direction.origin.longitude],
              [bearingEnd.latitude, bearingEnd.longitude],
            ]}
            pathOptions={BEARING_LINE_OPTIONS}
          />
        </>
      )}

      {mode === 'perimeter' ? (
        <>
          <PerimeterFitter
            bbox={perimeter}
            areaKey={perimeterKey}
            reducedMotion={reducedMotion}
            fitToken={fitToken}
          />
          <PerimeterDrawer onBoundsSelected={onPerimeterSelected} />
        </>
      ) : (
        <>
          <DirectionFitter
            direction={direction}
            reducedMotion={reducedMotion}
            fitToken={fitToken}
          />
          <DirectionPicker
            direction={direction}
            pendingOrigin={pendingDirectionOrigin}
            onPendingOriginChange={onPendingDirectionOriginChange}
            onDirectionChange={onDirectionChange}
          />
        </>
      )}

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
