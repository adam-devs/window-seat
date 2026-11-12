import { useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Rectangle,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { BoundingBox } from '../types';
import type { Aircraft } from '../data/types';
import { msToKnots, mToFeet } from '../utils/opensky';

// Fix Leaflet's default icon path issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Plane icon that rotates according to heading
function planeIcon(heading: number | null, selected: boolean) {
  const color = selected ? '#f59e0b' : '#3b82f6';
  const rotation = heading ?? 0;
  return L.divIcon({
    className: '',
    html: `<div style="transform: rotate(${rotation}deg); font-size: 20px; line-height: 1; color: ${color}; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5))">✈</div>`,
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
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
  radiusKm: number;
  mode: 'location' | 'perimeter';
  locationCenter: [number, number] | null;
  onPerimeterSelected: (bbox: BoundingBox) => void;
  selectedFlight: string | null;
  onSelectFlight: (icao24: string | null) => void;
}

export function FlightMap({
  flights,
  bbox,
  radiusKm,
  mode,
  locationCenter,
  onPerimeterSelected,
  selectedFlight,
  onSelectFlight,
}: FlightMapProps) {
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

      {/* Draw the active bounding area */}
      {mode === 'location' && locationCenter && (
        <Circle
          center={locationCenter}
          radius={radiusKm * 1000}
          pathOptions={{ color: '#3b82f6', fillOpacity: 0.05, weight: 1.5 }}
        />
      )}
      {mode === 'perimeter' && bbox && (
        <Rectangle
          bounds={[[bbox.lamin, bbox.lomin], [bbox.lamax, bbox.lomax]]}
          pathOptions={{ color: '#3b82f6', fillOpacity: 0.05, weight: 1.5 }}
        />
      )}

      {/* Perimeter drawing interaction */}
      {mode === 'perimeter' && (
        <PerimeterDrawer onBoundsSelected={onPerimeterSelected} />
      )}

      {/* Plane markers */}
      {flights.map((flight) => (
        <Marker
          key={flight.icao24}
          position={[flight.latitude, flight.longitude]}
          icon={planeIcon(flight.true_track, flight.icao24 === selectedFlight)}
          eventHandlers={{
            click: () => onSelectFlight(flight.icao24 === selectedFlight ? null : flight.icao24),
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
      ))}
    </MapContainer>
  );
}
