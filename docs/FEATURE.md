# Window Seat — Feature Specification

> **Status:** Draft for the restart
> **Last updated:** 2026-11-12
> **Current implementation:** commit `d5f7696` (branded "SkyWatch")
> **Target product name:** Window Seat

This document describes both what the app does today and what it should do next.
The current-state sections are an accurate inventory of the existing code. The
target-state sections are requirements for the restart and are not yet built.

---

## 1. Overview

### 1.1 Purpose

Window Seat is a lightweight web app for seeing aircraft around a chosen
location — "what is flying near my window right now?"

The app is a real-time viewer, not a flight planner or historical tracker. A user
picks a place (or their current position), optionally draws a custom area, and
gets a live map and list of aircraft in that area.

### 1.2 Target user

- An aviation-curious person at home who wants to identify traffic overhead or
  nearby.
- A user with no account, no API key, and no desire to configure a backend.
- A desktop or mobile web user who expects the map to feel alive rather than
  refresh in visible jumps.

### 1.3 Goals

- **Zero friction:** open the app and see traffic around a remembered location.
- **Smooth:** aircraft move continuously between feed updates instead of jumping.
- **Legible:** find, filter, and inspect an aircraft quickly.
- **Resilient:** degrade gracefully around rate limits, stale data, and errors.
- **Local-first:** no accounts; preferences and home location stay on the device.
- **Focused:** do one job — nearby aircraft — well.

### 1.4 Non-goals

- Observer-relative geometry: distance from the user, compass bearing, elevation
  angle, visibility cone, and overhead-pass prediction are **out of scope**.
- Flight planning, ticketing, schedules, arrivals/departures, or route lookup.
- Historical playback, fleet tracking, or a long-term aircraft database.
- Accounts, cross-device sync, or a server-side user database.
- Production hosting or deployment: the app runs locally through the Vite dev
  server. A hosted proxy/backend is out of scope.
- Guaranteed global coverage or professional-grade data accuracy.
- Native mobile or desktop apps.

### 1.5 Status legend

| Symbol | Meaning |
| --- | --- |
| ✅ | Implemented in the current code |
| 🟡 | Partially implemented or has significant gaps |
| ⛔ | Not implemented |
| 🔭 | Target feature for the restart |

Priorities use **P0** (must-have for restart), **P1** (should-have), and
**P2** (later).

---

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **State vector** | One aircraft observation from an ADS-B/OpenSky-style feed: position, altitude, velocity, heading, and metadata. |
| **Bounding box** | Axis-aligned geographic query area defined by `lamin`, `lomin`, `lamax`, `lomax`. |
| **Location mode** | Circular search area centered on a searched or detected point, with a radius. |
| **Perimeter mode** | Rectangular search area drawn by clicking two corners on the map. |
| **Snapshot** | One response from the data provider at a point in time. |
| **Interpolation** | Animating between two known observations. |
| **Extrapolation / dead reckoning** | Estimating a position beyond the latest observation using heading and speed. |
| **Stale contact** | An aircraft whose last observation is older than the freshness threshold. |
| **Trail** | A polyline of recent observed positions for an aircraft. |
| **Provider** | A data source adapter (OpenSky, airplanes.live, adsb.lol, etc.). |

---

## 3. Current implementation (as-built)

The current app is a single-page React 18 + TypeScript + Vite application using
react-leaflet 4 and Leaflet 1.9. It is approximately 950 lines of source and
styles, with no tests, linting, or deployment configuration.

### 3.1 Area selection ✅ / 🟡

- **Location mode** ✅
  - Search a city or place by name through Nominatim; the first result is used.
  - "My Location" requests browser geolocation.
  - Radius slider: 50–500 km, step 25, default 150 km.
  - Renders a blue circle overlay and queries a bounding box derived from the
    center and radius.
- **Perimeter mode** ✅ / 🟡
  - Click two corners on the map to define a rectangle.
  - First click drops a marker; second click commits the bounding box.
  - Renders a blue rectangle overlay.
  - Re-clicking two new corners redraws the area.
- **Clear** ✅
  - Removes the perimeter, location center, and selection.
- **Gaps**
  - The map never fits to the selected area; it stays at the hard-coded London
    center and zoom 7.
  - No way to adjust an existing area apart from redrawing it.
  - The radius is not persisted.
  - Geocoding has no debounce, cancellation, or rate-limit handling.

### 3.2 Data retrieval ✅ / 🟡

- Calls `GET /opensky/api/states/all` with a bounding box through the Vite dev
  proxy (`/opensky` → `https://opensky-network.org`).
- Parses positional state-vector arrays into typed objects.
- Drops aircraft without both latitude and longitude.
- Auto-refreshes every 15 seconds; manual refresh restarts the interval.
- Clears the list when no bounding box is active.
- **Gaps**
  - ~~Sends a literal placeholder credential.~~ Fixed 2026-11-12: the fake
    header was removed and the Vite dev proxy now injects an OAuth2 bearer token
    from `.env.local`, falling back to anonymous access.
  - 15-second polling produces roughly 5,760 requests per day, which does not fit
    the OpenSky daily credit model. There is no request budget or backoff.
  - No handling for HTTP 429, 5xx, timeouts, or aborted requests.
  - A failed poll replaces the visible data with an error state; last-good data
    is not retained.
  - CORS requires the dev proxy; production hosting is out of scope.
  - Response shape is not validated at runtime.

### 3.3 Map ✅ / 🟡

- OpenStreetMap raster tiles with attribution.
- Aircraft markers use a rotated emoji (`✈`), blue by default and orange when
  selected.
- Markers show a popup with callsign, country, altitude, and speed.
- Clicking a marker selects or deselects the aircraft.
- Circle and rectangle overlays visualize the active search area.
- **Gaps**
  - Marker icons are recreated on every render.
  - Positions jump on each refresh; there is no interpolation, extrapolation, or
    trail.
  - No altitude styling, decluttering, clustering, or follow mode.
  - No stale-aircraft indication.
  - On-ground aircraft are shown on the map but hidden from the list.
  - No loading indicator on the map itself.

### 3.4 Sidebar and detail card ✅ / 🟡

- Header shows product name, update time, error message, and airborne count.
- Flight list shows callsign, country, altitude, and speed.
- Clicking a row selects the aircraft; clicking again deselects.
- Detail card shows ICAO24, country, barometric altitude, speed, vertical rate,
  heading, squawk, and airborne/ground status.
- Link to FlightRadar24 using callsign (or ICAO24 as fallback).
- **Gaps**
  - No sorting, filtering, or callsign search.
  - The list shows only airborne aircraft, while the map shows all aircraft.
  - The detail card disappears when the selected aircraft leaves the feed.
  - Empty state says "Set a search area on the map" even when an area is set but
    has no aircraft.
  - No unit toggle; everything is aviation units (ft, kts, fpm).
  - FlightRadar24 URL may be invalid when a callsign is missing.
  - Rows are not memoized and the list has no virtualization.

### 3.5 Location services ✅ / 🟡

- Nominatim search endpoint, `limit=1`, English language header.
- Browser geolocation via `navigator.geolocation.getCurrentPosition`.
- Errors are surfaced in a red banner.
- **Gaps**
  - No debounce or request cancellation.
  - No handling for ambiguous results or multiple matches.
  - No Nominatim usage-policy headers or user-agent/contact configuration.
  - Geolocation permission denial only produces a generic message.

### 3.6 UI states, theming, responsive ✅ / 🟡

- Dark theme driven by CSS variables in `src/app.css`.
- Toolbar plus map plus 300 px sidebar layout.
- Below 700 px, the layout stacks and the sidebar becomes a 40vh panel.
- **Gaps**
  - No light theme.
  - No first-load skeleton; only text changes.
  - No stale, offline, or rate-limited state.
  - Mobile map resizing can require an explicit Leaflet invalidation after layout
    changes.
  - No reduced-motion handling for future animations.
  - Missing `/plane.svg` favicon referenced by `index.html`.
  - Empty leftover `src/{components,hooks,types,utils}` directory in the repo.

### 3.7 Current feature summary

| Area | Current status |
| --- | --- |
| Place search and GPS | ✅ basic |
| Radius search | ✅ basic |
| Perimeter drawing | 🟡 two-click only |
| Auto-fit to area | ⛔ |
| Live map markers | ✅ basic |
| Smooth motion / trails | ⛔ |
| Flight list | 🟡 no sort/filter/search |
| Aircraft detail | ✅ basic |
| Selection persistence | 🟡 lost when aircraft leaves feed |
| Data provider abstraction | ⛔ |
| Rate-limit handling | ⛔ |
| Last-good data / stale state | ⛔ |
| Settings / persistence | ⛔ |
| Units toggle | ⛔ |
| Mobile layout | 🟡 functional but cramped |
| Accessibility | 🟡 partial |
| Tests / lint / CI | ⛔ |

---

## 4. Target features (restart)

### F1 — Location workspace (P0)

A remembered working location so the app is useful immediately on return.

- **F1.1 Saved home center** — persist the last center (coordinates and display
  label) locally.
- **F1.2 Saved radius and mode** — persist radius and last selection mode.
- **F1.3 Startup behavior** — restore the saved workspace if present; otherwise
  show a focused prompt to search a place or use current location. Do not
  silently query an arbitrary default city.
- **F1.4 Change and clear** — clear the area without losing saved preferences;
  search or use GPS to replace it.
- **F1.5 No account** — no login, no server-side profile.

**Acceptance:** reopening the app restores the previous area and starts fetching
without user input; clearing shows an explicit empty map state.

### F2 — Area selection (P0)

- **F2.1 Place search**
  - Debounced input with in-flight request cancellation.
  - Clear "no results" and network-error messages.
  - Show the resolved place name in the UI.
  - Follow the geocoder's usage policy.
- **F2.2 Use my location** — request geolocation, handle denial and timeout with
  actionable messages.
- **F2.3 Radius control** — slider plus numeric readout; support 25–500 km with a
  25 km step and a 150 km default. (Current minimum is 50 km.)
- **F2.4 Perimeter drawing** — two-click rectangle plus drag-to-draw; preview the
  rectangle before commit; allow redraw and cancel.
- **F2.5 Auto-fit** — fit the map to the circle or rectangle when the area
  changes, with padding and a sensible maximum zoom.
- **F2.6 Area validation** — reject degenerate, antimeridian-crossing, or
  oversized boxes with a clear message.
- **F2.7 Persistence** — restore the last area on load.

**Acceptance:** selecting a place or drawing a rectangle visibly frames the area
on the map and triggers a fetch exactly once for that area.

### F3 — Map and smooth tracking (P0)

The defining behavior of the restart: the map should feel continuous.

- **F3.1 Basemap** — OpenStreetMap raster tiles with visible attribution; keep
  the provider configurable.
- **F3.2 Aircraft markers**
  - Rotate to heading, interpolating rotation between updates.
  - Color or size by altitude band.
  - Clearly distinguish selected aircraft.
  - Dim stale aircraft rather than leaving them fully opaque.
  - Keep marker instances stable across refreshes.
- **F3.3 Interpolation and extrapolation**
  - Animate each aircraft from its last known position toward a predicted
    position using reported ground speed and track.
  - Cap extrapolation (for example, at 30 seconds or two refresh intervals,
    whichever is smaller) so aircraft do not drift indefinitely.
  - When a fresh snapshot arrives, correct to the observed position with a short
    eased transition (roughly 0.5–1 s) instead of snapping.
  - If no track or velocity is available, hold position and fade toward stale.
  - Mark extrapolated positions as estimates in the UI.
- **F3.4 Trails**
  - Keep a rolling history of observed positions per aircraft (default 120 s).
  - Render observed history distinctly from the extrapolated segment.
  - Cap history per aircraft and drop data when an aircraft leaves the area.
- **F3.5 Selection and follow**
  - Selecting from map or list highlights both.
  - Optional "follow" recenters on the selected aircraft.
  - Popups show callsign, altitude, speed, and status.
  - Preserve the detail card with a stale indicator if contact is lost, rather
    than removing it immediately.
- **F3.6 Decluttering**
  - Cluster or reduce markers at low zoom, or cap rendered aircraft with a clear
    indication.
  - Prevent marker overlap from making selection impossible.
- **F3.7 Ground traffic** — show on-ground aircraft consistently in both map and
  list, or provide an explicit filter; today the map and list disagree.
- **F3.8 Reduced motion** — honor `prefers-reduced-motion` by reducing or
  disabling interpolation/trails while keeping data current.

**Acceptance:** at a normal refresh interval, aircraft visibly glide between
updates; a new snapshot causes no visible jump; stale aircraft are visually
distinct; the UI remains responsive with several hundred aircraft.

### F4 — Flight browsing (P1)

- **F4.1 Sorting** — callsign, altitude, speed, vertical rate, and last update.
- **F4.2 Filtering** — airborne/on-ground, altitude band, and moving/stationary.
- **F4.3 Callsign search** — filter the list and optionally highlight matches on
  the map.
- **F4.4 Sticky selection** — selection survives refreshes; if the aircraft
  leaves the feed, keep its last-known detail marked stale until the user
  deselects or the area changes.
- **F4.5 Richer detail card** — keep current fields, add last-contact age,
  position source, and available provider extras (registration, type, operator)
  when the provider supplies them.
- **F4.6 External links** — FlightRadar24 and one alternate lookup; validate the
  identifier and hide links when no usable identifier exists.
- **F4.7 Units** — aviation (ft, kts, fpm) and metric (m, km/h, m/s) display;
  see F6.
- **F4.8 List performance** — memoized rows and virtualization or windowing for
  large counts.

**Acceptance:** the list can be sorted, filtered, and searched without blocking
the map; selection remains coherent across a refresh.

### F5 — Data layer (P0)

- **F5.1 Provider abstraction** — a common interface so sources can be swapped.
- **F5.2 Multiple adapters** — at minimum OpenSky plus one community ADS-B
  provider; normalise fields into the internal model.
- **F5.3 Request budgeting**
  - Per-provider minimum interval and optional daily budget.
  - Never schedule more requests than the budget allows; surface the effective
    cadence.
  - Suspend auto-refresh when the budget is exhausted and tell the user when it
    resets.
- **F5.4 Backoff** — exponential backoff with jitter on 429/5xx and network
  failures; reset on success.
- **F5.5 Last-good data** — retain the previous successful snapshot; show a stale
  banner instead of blanking the UI.
- **F5.6 Cancellation** — abort in-flight requests when the area changes.
- **F5.7 Credentials** — read optional credentials from environment/config; never
  ship a literal placeholder token.
- **F5.8 Local transport** — use the Vite dev proxy to bypass CORS and inject
  OAuth2 credentials server-side. Production hosting is out of scope.
- **F5.9 Normalisation** — one internal state model with SI units; map provider
  fields defensively and reject malformed records.

**Acceptance:** a 429 or transient failure leaves the last snapshot visible;
recovery is automatic; no hard-coded credentials exist in source.

### F6 — Settings and persistence (P1)

- **F6.1 Units** — aviation or metric, default decided during implementation
  (open question).
- **F6.2 Refresh cadence** — options constrained by the active provider's limits.
- **F6.3 Theme** — dark by default; optional light theme using the existing CSS
  variable approach.
- **F6.4 Provider choice** — optionally expose provider selection when more than
  one is configured.
- **F6.5 Storage schema** — versioned `localStorage` payload; safe fallback and
  reset on invalid data.
- **F6.6 Reset** — a single action to clear saved settings and home location.

**Acceptance:** preferences survive reloads; corrupt storage does not break
startup.

### F7 — UI states (P1)

- **F7.1 First load** — skeleton or quiet loading state; no flash of "no data."
- **F7.2 Background refresh** — subtle updating indicator; never block the map.
- **F7.3 Empty** — distinguish "no area selected" from "area selected, no
  aircraft."
- **F7.4 Stale** — show data age and a stale banner when the last success is old.
- **F7.5 Error** — non-destructive banner with retry; keep existing data.
- **F7.6 Rate limited** — explain the limit and when polling resumes.
- **F7.7 Offline** — detect and report network loss; retry on reconnect.

**Acceptance:** every failure mode has a distinct, non-destructive message.

### F8 — Performance and responsive layout (P0 for performance)

- **F8.1 Rendering** — stable Leaflet icon instances, memoized list rows, and
  animation driven outside React's render path where practical.
- **F8.2 Scale** — target smooth interaction with several hundred aircraft;
  cap trails and rendered markers.
- **F8.3 Mobile** — convert the sidebar into a bottom sheet or collapsible panel;
  ensure touch targets, safe-area insets, and map resize handling.
- **F8.4 Asset weight** — keep the initial bundle small; lazy-load non-critical
  UI.
- **F8.5 Memory** — clear per-aircraft history and timers when aircraft or areas
  are removed.
- **F8.6 Animation budget** — target 60 fps on a typical laptop and a stable
  30 fps or better on mid-range mobile.

**Acceptance:** no visible jank while panning, selecting, or refreshing with a
full area.

### F9 — Accessibility (P2)

- **F9.1 Keyboard** — reachable toolbar controls, list rows, and detail actions;
  visible focus states.
- **F9.2 Labels** — accessible names for icon-only buttons and form controls.
- **F9.3 Live updates** — polite announcements for aircraft count and selection;
  avoid announcing every position update.
- **F9.4 Contrast** — meet WCAG AA for text and controls in both themes.
- **F9.5 Reduced motion** — as in F3.8.
- **F9.6 Map alternative** — the list provides a non-visual way to browse
  aircraft.

**Acceptance:** the core flow (search area → browse list → open detail) works
without a mouse.

---

## 5. Data source evaluation

The current app depends on OpenSky only. The restart should isolate the provider
behind an adapter and evaluate the options below. Limits and terms change
frequently; confirm them during implementation.

| Provider | Access / auth | Typical limits | Nearby-position query | Extra fields | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **OpenSky Network** | Free account; OAuth2/client credentials or basic auth | Credit-based daily quota; state resolution around 10 s | Bounding-box `states/all` | No registration/type in state vectors | Free | Current source; requires a proxy for browser use; good fallback |
| **airplanes.live** | No key | Fair-use request rate (roughly 1 req/s) | Point + radius, hex, callsign | Registration, type, operator often available | Free | Community ADS-B; verify CORS and terms |
| **adsb.lol** | No key | Fair-use request rate | Point + radius, hex, callsign | Similar community coverage | Free | Alternative to airplanes.live; verify CORS and terms |
| **ADS-B Exchange** | Paid API key | Plan-dependent | Bounding-box/point queries | Rich unfiltered data | Paid | Consider only if free sources prove insufficient |
| **FlightAware AeroAPI** | Paid API key | Plan/credit-based | Flight lookup rather than bulk nearby positions | Schedules, routes, status | Paid | Not a drop-in replacement for nearby traffic |
| **AirLabs** | Freemium key | Plan-dependent | Flight/schedule oriented | Routes, airports, schedules | Freemium | Better for enrichment than live positions |

### 5.1 Evaluation criteria

1. No-key, browser-accessible access (CORS) or a viable proxy.
2. Nearby query support with a usable radius.
3. Update frequency and freshness.
4. Field richness (callsign, altitude, speed, track, type, registration).
5. Rate-limit predictability and documented terms.
6. Cost.
7. Reliability and coverage in the target regions.

### 5.2 Recommendation

- Build a provider interface first.
- For the current local-only scope, use authenticated OpenSky through the Vite
  dev proxy; anonymous access is the fallback.
- Defer community ADS-B providers until OpenSky freshness or field coverage
  proves insufficient for smooth tracking.
- Keep all provider-specific mapping in adapters so swapping sources does not
  touch UI code.
- Do not assume paid providers; document them as an upgrade path.
- Verify current terms, CORS behavior, and limits before adding a provider.

---

## 6. Data contracts

### 6.1 Internal aircraft model

The internal model should be provider-neutral and use SI units; display
conversion happens at the edge.

```ts
interface Aircraft {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  latitude: number | null;
  longitude: number | null;
  baroAltitudeM: number | null;
  geoAltitudeM: number | null;
  onGround: boolean;
  velocityMs: number | null;
  trueTrackDeg: number | null;
  verticalRateMs: number | null;
  squawk: string | null;
  positionSource: PositionSource;
  lastContact: number;      // Unix seconds
  lastPosition: number | null;
  // Optional provider extras
  registration?: string | null;
  aircraftType?: string | null;
  operator?: string | null;
  category?: string | null;
}

type PositionSource = 'adsb' | 'mlat' | 'flarm' | 'unknown';
```

### 6.2 Bounding box

```ts
interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}
```

### 6.3 Provider interface

```ts
interface FlightProvider {
  id: string;
  name: string;
  minIntervalMs: number;
  dailyBudget?: number;
  capabilities: {
    registration: boolean;
    aircraftType: boolean;
    operator: boolean;
  };
  fetchFlights(bbox: BoundingBox, signal: AbortSignal): Promise<Aircraft[]>;
}
```

### 6.4 Persistence schema

```ts
interface StoredSettingsV1 {
  version: 1;
  home: { lat: number; lng: number; label: string } | null;
  radiusKm: number;
  mode: 'location' | 'perimeter';
  perimeter: BoundingBox | null;
  units: 'aviation' | 'metric';
  theme: 'dark' | 'light';
  refreshMs: number;
  providerId: string | null;
}
```

Unknown or invalid payloads fall back to defaults; never throw during startup.

### 6.5 Provider field mapping

- Normalise timestamps to Unix seconds.
- Normalise altitude and vertical rate to metres and m/s; speed to m/s.
- Preserve `null` for unknown values; do not coerce to zero.
- Reject records missing both coordinates.
- Record the provider ID on each snapshot for provenance/debugging.

---

## 7. Non-functional requirements

### 7.1 Refresh and rate budget

- Choose the default cadence from the provider's limits, not a fixed 15 s.
- Compute the daily request cost of a cadence before shipping it. For example,
  15 s polling is 5,760 requests/day.
- Pause or slow polling when the budget is low; explain the state in the UI.
- Never retry aggressively; use backoff with jitter.

### 7.2 Smoothness

- 60 fps animation target on desktop; stable 30 fps or better on mid-range mobile.
- Position correction after a new snapshot completes within about 1 s and never
  visibly snaps.
- Extrapolation is capped and clearly presented as an estimate.
- Trails are bounded in duration and point count.

### 7.3 Freshness

- Define freshness relative to the provider's update resolution.
- Dim or mark aircraft whose last contact exceeds the stale threshold (for
  example, 60 s).
- Show the age of the displayed snapshot.

### 7.4 Privacy

- Geolocation is requested only on user action; coordinates are stored locally.
- No analytics or tracking scripts by default.
- Third-party requests are limited to the map tiles, geocoder, and flight
  provider; document them.
- A privacy note explains what leaves the device.

### 7.5 Browser support

- Current evergreen Chrome, Firefox, Safari, and Edge.
- iOS Safari and Android Chrome for the mobile layout.
- Graceful behavior when geolocation or storage is unavailable.

### 7.6 Reliability

- Keep last-good data visible through transient failures.
- Recover automatically when the provider or network returns.
- Never leave multiple polling timers running after an area change.

### 7.7 Maintainability

- TypeScript strict mode.
- Unit tests for parsing, bounding-box math, interpolation, and persistence.
- Lint and formatting checks in CI.
- No committed credentials or placeholder tokens.

---

## 8. Current → target matrix

| Feature | Current | Target | Priority |
| --- | --- | --- | --- |
| Saved home and radius | ⛔ | F1.1–F1.2 | P0 |
| Restore workspace on load | ⛔ | F1.3 | P0 |
| Place search | 🟡 | F2.1 | P0 |
| GPS location | 🟡 | F2.2 | P1 |
| Radius control | ✅ | F2.3 | P1 |
| Perimeter drawing | 🟡 | F2.4 | P1 |
| Auto-fit map | ⛔ | F2.5 | P1 |
| Smooth marker motion | ⛔ | F3.3 | P0 |
| Aircraft trails | ⛔ | F3.4 | P1 |
| Altitude styling / decluttering | ⛔ | F3.2 / F3.6 | P1 |
| Follow selected aircraft | ⛔ | F3.5 | P2 |
| Consistent ground traffic | 🟡 | F3.7 | P1 |
| Sort / filter / search | ⛔ | F4.1–F4.3 | P1 |
| Sticky detail card | 🟡 | F4.4 | P1 |
| Rich detail fields | 🟡 | F4.5 | P2 |
| Units toggle | ⛔ | F6.1 / F4.7 | P1 |
| Provider abstraction | ⛔ | F5.1–F5.2 | P0 |
| Request budget / backoff | ⛔ | F5.3–F5.4 | P0 |
| Last-good data | ⛔ | F5.5 | P0 |
| Request cancellation | ⛔ | F5.6 | P1 |
| Credentials via config | ⛔ | F5.7 | P0 |
| Production proxy path | ⛔ | F5.8 | P0 |
| Settings persistence | ⛔ | F6 | P1 |
| Distinct UI states | 🟡 | F7 | P1 |
| List virtualization | ⛔ | F4.8 | P2 |
| Mobile bottom sheet | 🟡 | F8.3 | P1 |
| Accessibility pass | 🟡 | F9 | P2 |
| Tests / lint / CI | ⛔ | 7.7 | P2 |

---

## 9. Audit: bugs, risks, and technical debt

| ID | Severity | Area | Finding | Resolution |
| --- | --- | --- | --- | --- |
| A1 | Critical | Data | `Authorization: 'Basic ' + btoa('$TOKEN')` sent a literal placeholder credential. | **Resolved 2026-11-12:** fake header removed; the Vite dev proxy injects an OAuth2 bearer token from `.env.local`, with anonymous fallback. |
| A2 | Critical | Data | 15 s polling ≈ 5,760 requests/day against a daily-credit API; no budget, backoff, or 429 handling. | Provider-aware cadence and budgeting (F5.3–F5.4). |
| A3 | High | Data | A failed poll replaces data with an error; no last-good snapshot. | Retain last success and show a stale banner (F5.5, F7.5). |
| A4 | High | Data | In-flight requests are not cancelled when the area changes; overlapping timers are possible. | AbortController and a single polling lifecycle (F5.6). |
| A5 | High | Map | Positions jump on every refresh; no interpolation or trails. | Smoothing layer (F3.3–F3.4). |
| A6 | High | Map | Marker icons are recreated on every render. | Stable icon instances and memoization (F8.1). |
| A7 | Medium | Map | Map never fits to the selected area; starts at London regardless of search. | Auto-fit (F2.5). |
| A8 | Medium | Map/list | Map shows on-ground aircraft; the list filters them out. | Unify behavior or add an explicit filter (F3.7). |
| A9 | Medium | Detail | Selected aircraft vanishes when it leaves the feed. | Sticky last-known detail with stale state (F4.4). |
| A10 | Medium | UI | Empty state says "Set a search area" even when an area is set with no aircraft. | Distinguish empty causes (F7.3). |
| A11 | Medium | Geocoding | No debounce, cancellation, or provider-policy headers. | Harden search flow (F2.1). |
| A12 | Medium | Config | No environment/config mechanism; dev-only proxy; no production strategy. | **Partially resolved 2026-11-12:** `.env.local` + `.env.example` and a Vite OAuth2 proxy. Typed app config still pending; production is out of scope. |
| A13 | Medium | Units | Hard-coded aviation units; no metric option. | Units setting (F6.1). |
| A14 | Low | Links | FlightRadar24 URL may be invalid without a callsign. | Validate identifier; hide invalid links (F4.6). |
| A15 | Low | Types | Position source is a raw number; response tuples are not validated. | Typed enum and defensive parsing (F5.9). |
| A16 | Low | Repo | Empty `src/{components,hooks,types,utils}` directory; missing `/plane.svg`; no tests/lint/CI. | Brace directory removed 2026-11-12; favicon and tooling remain. |
| A17 | Low | Mobile | Sidebar is a cramped 40vh panel; map may need resize invalidation. | Bottom sheet and resize handling (F8.3). |
| A18 | Low | A11y | Icon-only buttons lack accessible names; no focus styling documented. | Accessibility pass (F9). |

---

## 10. Open questions and out of scope

### Open questions

- Default units: aviation or metric?
- Whether to add community providers after OpenSky proves insufficient, or stay
  OpenSky-only.
- Whether to request OpenSky `extended=1` for aircraft category data.
- Whether to keep the FlightRadar24 link as the only external lookup.
- Default radius (suggested 150 km) and whether to allow below 25 km.
- Maximum aircraft count to render before clustering or capping.
- Whether a light theme is in scope for the restart or later.
- Localization and time-zone display.

### Explicitly out of scope

- Distance, bearing, elevation, visibility cone, and overhead-pass prediction.
- Accounts, sync, and server-side storage.
- Production hosting, deployment, or a hosted proxy.
- Route, airline, schedule, arrival, and departure enrichment.
- Historical playback and long-term data retention.
- Paid real-time feeds as a baseline requirement.
- Native apps.

---

## 11. Change log

| Date | Change |
| --- | --- |
| 2026-11-12 | Initial specification: current-state inventory, target features F1–F9, provider evaluation, contracts, audit. |
| 2026-11-12 | Local-only scope confirmed; local OAuth2 proxy implemented; fake credential removed; A1 resolved, A12 partially resolved. |
