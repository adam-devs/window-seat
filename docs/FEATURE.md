# WindowSeat — Feature Specification

> **Status:** M1 and M2.0 implemented; M2.1 and later planned
> **Last updated:** 2026-11-12
> **Current implementation:** M1 + M2.0 as of 2026-11-12 (branded "WindowSeat")
> **Target product name:** WindowSeat

This document describes both what the app does today and what it should do next.
The pre-restart inventory in section 3 is retained as a baseline; sections 3.8
and 3.9 record what M1 and M2.0 changed. The target-state sections are
requirements and are not all built yet. Planned scope changes are called out
explicitly.

---

## 1. Overview

### 1.1 Purpose

WindowSeat is a lightweight web app for seeing aircraft around a chosen
location — "what is flying near my window right now?"

The app is a real-time viewer, not a flight planner or historical tracker. The
user draws a rectangular perimeter on the map and gets a live map and list of
aircraft inside it. Location/place search, GPS, and radius selection were removed
in M2.0; perimeter is the only current mode.

### 1.2 Target user

- An aviation-curious person at home who wants to identify traffic overhead or
  nearby.
- A user with no account, no API key, and no desire to configure a backend.
- A desktop or mobile web user who expects the map to feel alive rather than
  refresh in visible jumps.

### 1.3 Goals

- **Zero friction:** open the app and draw a perimeter, or see traffic around a
  remembered area.
- **Smooth:** aircraft move continuously between feed updates instead of jumping.
- **Legible:** find, filter, and inspect an aircraft quickly.
- **Resilient:** degrade gracefully around rate limits, stale data, and errors.
- **Local-first:** no accounts; preferences and the perimeter stay on the device.
- **Focused:** do one job — nearby aircraft — well.

### 1.4 Non-goals

- **Per-aircraft observer-relative readouts:** distance from the user, compass
  bearing, elevation angle, and overhead-pass prediction are **out of scope** in
  the core list/detail UI.
  - **Planned exception (M3.5):** an optional “View” mode pins an origin, takes a
    second-click bearing, draws a visibility cone, and filters aircraft within a
    saved distance. The cone is a view/query tool; it does not add distance or
    bearing rows to the detail card.
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
| **Perimeter mode** | Rectangular search area drawn by clicking two corners on the map; the only current mode. |
| **View mode (in progress)** | Pinned origin plus a second-click bearing; draws a visibility cone. Aircraft filtering and the visibility-distance control are pending. |
| **Snapshot** | One response from the data provider at a point in time. |
| **Interpolation** | Animating between two known observations. |
| **Extrapolation / dead reckoning** | Estimating a position beyond the latest observation using heading and speed. |
| **Stale contact** | An aircraft whose last observation is older than the freshness threshold. |
| **Trail** | A polyline of recent observed positions for an aircraft. |
| **Provider** | A data source adapter (OpenSky, airplanes.live, adsb.lol, etc.). |

---

## 3. Pre-restart implementation (baseline, commit `d5f7696`)

The pre-restart app was a single-page React 18 + TypeScript + Vite application
using react-leaflet 4 and Leaflet 1.9. It was approximately 950 lines of source
and styles, with no tests, linting, or deployment configuration.

> **M1 update (2026-11-12):** the data layer, request policy, flight hook, status
> handling, and settings UI have been rebuilt. The gaps described in 3.2–3.6 are
> historical; see **3.8** for the current M1 status.
>
> **M2.0 update (2026-11-12):** location mode, place search, GPS, geocoding, and
> radius controls have been removed. Perimeter is the only selection mode; see
> **3.9**. The location bullets in 3.1 are historical.

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

### 3.8 M1 as-built status (2026-11-12)

M1 rebuilt the data path behind tested modules:

| Area | M1 status |
| --- | --- |
| Typed config + settings store | ✅ `src/config.ts`, versioned `localStorage`, clamping/reset |
| Provider model + OpenSky adapter | ✅ SI `Aircraft`/`Snapshot`, typed errors, defensive parsing |
| Provider registry | ✅ OpenSky; community adapters deferred |
| Cadence + credit budget | ✅ 30 s default, 4,000/day, 10% reserve, auto-pause at 90% |
| Backoff + cancellation | ✅ jittered retries, single-flight, abort on area change |
| Last-good data | ✅ retained through stale/error/rate-limit states |
| Flight hook metadata | ✅ data age, retry time, provider, live budget, effective cadence |
| Status presentation | ✅ stale/error/rate-limited/offline banner; load vs refresh header |
| Panel retention | ✅ rows, count, and detail card survive refreshes and failures |
| Refresh settings | ✅ persisted interval, effective-cadence explanation, reset |
| Tests | ✅ 401 Vitest tests across data, hook, and component layers |
| Build | ✅ `npm run build` passes |
| Manual matrix | ✅ real-browser checks incl. 503/429, offline, rapid redraw, hidden tab |

Subsequent status:
- M2.0 removed location mode; perimeter is the default selection mode, with the
  directional View as an optional mode.
- M2 smooth motion/trails and M3 workspace persistence, sort/filter/search, and
  units are implemented.
- The M3.5 View interaction (pin, bearing, cone) is implemented; its
  query/filter and distance controls remain pending.
- Mobile/accessibility (M4) and the visual pass (M5) remain deferred.
- Community providers remain deferred.
- Lint/CI remain unconfigured; tests and the production build are the current
  local gates.

### 3.9 M2.0 as-built status (2026-11-12)

M2.0 makes the app perimeter-only:

| Area | M2.0 status |
| --- | --- |
| Location mode | ✅ removed (tab, search, GPS, radius, `locationCenter`, `radiusKm`) |
| Geocoding | ✅ removed; no Nominatim requests or geolocation permission |
| Perimeter selection | ✅ two-click rectangle, redraw, Clear, selected-aircraft markers |
| Map rendering | ✅ perimeter rectangle only; location circle/marker removed |
| Copy | ✅ “draw your search box” / “Draw a perimeter on the map…” |
| Tests | ✅ 401 tests, including Toolbar perimeter-only copy/controls |
| Build | ✅ `npm run build` passes |
| Browser check | ✅ no off-scope requests; 136-aircraft perimeter fetch |

Still deferred within area selection:
- Auto-fit to the perimeter (M2/M3).
- Drag-to-draw and a pre-commit preview (F2.4).
- Workspace persistence of the last perimeter (M3).
- The future directional View mode and cone (M3.5).

---

## 4. Target features (restart)

> **Scope update (2026-11-12):** M2.0 has removed location search, geocoding,
> GPS, and the radius control; perimeter is the only selection mode and the
> default. F1, F2.1, F2.2, and F2.3 are superseded/removed. M3.5 adds an optional
> directional “View” mode (pinned origin, second-click bearing, 60° cone,
> persisted visibility distance); full scope is tracked in the plan roadmap.

### F1 — Location workspace (removed in M2.0)

**Status:** removed with location mode; there is no home center or radius
workspace. The M3 workspace requirement now covers the last perimeter instead.
This section is retained for history only.

### F2 — Area selection (perimeter current; location parts removed)

- **F2.1 Place search** — ❌ removed in M2.0 (no Nominatim/geocoding).
- **F2.2 Use my location** — ❌ removed in M2.0 (no GPS prompt).
- **F2.3 Radius control** — ❌ removed in M2.0.
- **F2.4 Perimeter drawing** — two-click rectangle is current; drag-to-draw, a
  pre-commit preview, and cancel are still targets.
- **F2.5 Auto-fit** — fit the map to the rectangle when the area changes, with
  padding and a sensible maximum zoom. Still a target.
- **F2.6 Area validation** — reject degenerate, antimeridian-crossing, or
  oversized boxes with a clear message. Still a target.
- **F2.7 Persistence** — restore the last perimeter on load (M3).

**Acceptance:** drawing a rectangle visibly frames the area and triggers exactly
one fetch for that area.

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

### F5 — Data layer (P0) — ✅ implemented in M1, except F5.2

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

### F6 — Settings and persistence (P1) — 🟡 refresh interval only

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

### F7 — UI states (P1) — ✅ implemented in M1

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

> **M1 implementation note (2026-11-12):** the shipped contract is in
> `src/data/types.ts`. It uses snake-case UI-compatible field names
> (`baro_altitude`, `true_track`, etc.), epoch-millisecond timestamps, and
> `fetchFlights(bbox, signal): Promise<Snapshot>`; a `Snapshot` wraps the
> `Aircraft[]` plus provider/time/cost metadata. The sketches below remain as
> the design intent.

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

**Current stores:** the legacy `window-seat:settings:v1` refresh key is read for
migration; `window-seat:workspace:v1` implements the schema below and App now
restores the saved perimeter on startup (auto-fit included). Units/theme UI is
pending M3.4; budget usage remains in `window-seat:budget:v1`. Location/radius
fields were removed with M2.0.

```ts
interface StoredWorkspaceV1 {
  version: 1;
  perimeter: BoundingBox | null;
  mode: 'perimeter' | 'direction';
  direction: {
    origin: { lat: number; lng: number };
    bearingDeg: number;
    angleDeg: number;
    visibilityKm: number;
  } | null;
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

**Implemented in M1 (2026-11-12):** provider-aware cadence, per-request credit
cost, 90% auto-pause, manual reserve, 429/5xx backoff, and live cadence
explanations.

- Choose the default cadence from the provider's limits, not a fixed 15 s.
- Compute the daily request cost of a cadence before shipping it. For example,
  15 s polling is 5,760 requests/day.
- Pause or slow polling when the budget is low; explain the state in the UI.
- Never retry aggressively; use backoff with jitter.

### 7.2 Smoothness

**Implemented in M2.3–M2.5:** dead-reckoned marker motion with a 30 s/cadence
cap, eased snapshot correction, bounded observed trails with a distinct
projected segment, smooth rotation, altitude colours, selection emphasis, stale
dimming, and reduced-motion fallback. Decluttering remains.

**Measured 2026-11-12 (`npm run perf:check`):** 300 synthetic aircraft in
headless Chrome — 56.3 fps desktop / 56.9 fps mobile, max marker jump under
3 px, heap growth under 12 MB, and bounded DOM/trail counts. 50–100 aircraft hold
60 fps; the strict 60 fps target is not fully reached at 300 in headless
software rendering.

- 60 fps animation target on desktop; stable 30 fps or better on mid-range mobile.
- Position correction after a new snapshot completes within about 1 s and never
  visibly snaps.
- Extrapolation is capped and clearly presented as an estimate.
- Trails are bounded in duration and point count.

### 7.3 Freshness

**Implemented in M1:** relative data age, stale threshold, and stale banner.

- Define freshness relative to the provider's update resolution.
- Dim or mark aircraft whose last contact exceeds the stale threshold (for
  example, 60 s).
- Show the age of the displayed snapshot.

### 7.4 Privacy

- **Geolocation is no longer used** (removed in M2.0).
- No analytics or tracking scripts by default.
- Third-party requests are limited to map tiles and the flight provider; the
  geocoder was removed in M2.0.
- A privacy note explains what leaves the device.

### 7.5 Browser support

- Current evergreen Chrome, Firefox, Safari, and Edge.
- iOS Safari and Android Chrome for the mobile layout.
- Graceful behavior when storage is unavailable. Geolocation is not used.

### 7.6 Reliability

**Implemented in M1:** last-good retention, automatic retry, and single-flight
area changes.

- Keep last-good data visible through transient failures.
- Recover automatically when the provider or network returns.
- Never leave multiple polling timers running after an area change.

### 7.7 Maintainability

- TypeScript strict mode. ✅
- Unit tests for parsing, bounding-box math, interpolation, and persistence.
  🟡 parsing, policy/budget, settings, hook, component, dead-reckoning, motion,
  trail, visual-state, list controls, and performance-harness coverage are in
  place (401
  tests + `npm run perf:check`); lint/CI remain.
- Lint and formatting checks in CI. ⛔ (local test + build gates only)
- No committed credentials or placeholder tokens. ✅

---

## 8. Current → target matrix

| Feature | Current | Target | Priority |
| --- | --- | --- | --- |
| Saved perimeter workspace | ⛔ | M3 | P1 |
| Restore workspace on load | ⛔ | M3 | P1 |
| Place search | Removed (M2.0) | — | — |
| GPS location | Removed (M2.0) | — | — |
| Radius control | Removed (M2.0) | — | — |
| Perimeter drawing | ✅ two-click; drag/preview pending | F2.4 | P1 |
| Auto-fit map | ⛔ | F2.5 | P1 |
| Directional View mode | 🟡 pin/bearing/cone built; query/filter pending | M3.5 | P2 |
| Smooth marker motion | ⛔ | F3.3 | P0 |
| Aircraft trails | ✅ observed 120 s + projected segment | F3.4 | P1 |
| Altitude styling / marker legibility | ✅ 28 px north-up SVG + halo | F3.2 | P1 |
| Decluttering / clustering | ⛔ | F3.6 | P1 |
| Follow selected aircraft | ⛔ | F3.5 | P2 |
| Consistent ground traffic | 🟡 | F3.7 | P1 |
| Sort / filter / search | ✅ | F4.1–F4.3 | P1 |
| Sticky detail card | ✅ last-known badge | F4.4 | P1 |
| Rich detail fields | 🟡 | F4.5 | P2 |
| Units toggle | ✅ aviation/metric | F6.1 / F4.7 | P1 |
| Provider abstraction | ✅ | F5.1–F5.2 | P0 |
| Request budget / backoff | ✅ | F5.3–F5.4 | P0 |
| Last-good data | ✅ | F5.5 | P0 |
| Request cancellation | ✅ | F5.6 | P1 |
| Credentials via config | ✅ | F5.7 | P0 |
| Production proxy path | ⛔ (local-only scope) | F5.8 | P0 |
| Settings persistence | 🟡 perimeter/refresh/units ✅; theme UI ⛔ | F6 | P1 |
| Distinct UI states | ✅ | F7 | P1 |
| List virtualization | ⛔ | F4.8 | P2 |
| Mobile bottom sheet | 🟡 | F8.3 | P1 |
| Accessibility pass | 🟡 labels/focus started | F9 | P2 |
| Tests / lint / CI | 🟡 401 tests ✅; lint/CI ⛔ | 7.7 | P2 |

---

## 9. Audit: bugs, risks, and technical debt

| ID | Severity | Area | Finding | Resolution |
| --- | --- | --- | --- | --- |
| A1 | Critical | Data | `Authorization: 'Basic ' + btoa('$TOKEN')` sent a literal placeholder credential. | **Resolved 2026-11-12:** fake header removed; the Vite dev proxy injects an OAuth2 bearer token from `.env.local`, with anonymous fallback. |
| A2 | Critical | Data | 15 s polling ≈ 5,760 requests/day against a daily-credit API; no budget, backoff, or 429 handling. | **Resolved 2026-11-12 (M1.3):** provider-aware cadence, area cost, 4,000/day budget with 10% reserve, 90% auto-pause, backoff, and 429 handling. |
| A3 | High | Data | A failed poll replaces data with an error; no last-good snapshot. | **Resolved 2026-11-12 (M1.4):** last-good snapshot retained; non-destructive stale/error banner (F5.5, F7.5). |
| A4 | High | Data | In-flight requests are not cancelled when the area changes; overlapping timers are possible. | **Resolved 2026-11-12 (M1.3–M1.4):** latest-wins coordinator aborts stale requests; single pending poll; visibility pause. |
| A5 | High | Map | Positions jump on every refresh; no interpolation or trails. | Smoothing layer (F3.3–F3.4). |
| A6 | High | Map | Marker icons are recreated on every render. | Stable icon instances and memoization (F8.1). |
| A7 | Medium | Map | Map never fits to the selected area; starts at London regardless of the drawn perimeter. | Auto-fit (F2.5). |
| A8 | Medium | Map/list | Map shows on-ground aircraft; the list filters them out. | Unify behavior or add an explicit filter (F3.7). |
| A9 | Medium | Detail | Selected aircraft vanishes when it leaves the feed. | Sticky last-known detail with stale state (F4.4). |
| A10 | Medium | UI | Empty state says "Set a search area" even when an area is set with no aircraft. | **Resolved 2026-11-12 (M1.5):** `flightListState` distinguishes no-area, loading, unavailable, and genuinely empty states. |
| A11 | Medium | Geocoding | No debounce, cancellation, or provider-policy headers. | **Resolved (M2.0):** geocoding removed with location mode; no Nominatim dependency. |
| A12 | Medium | Config | No environment/config mechanism; dev-only proxy; no production strategy. | **Resolved 2026-11-12 (M1.1):** typed `config.ts`, `.env.local` + `.env.example`, Vite OAuth2 proxy; production remains out of scope. |
| A13 | Medium | Units | Hard-coded aviation units; no metric option. | Units setting (F6.1). |
| A14 | Low | Links | FlightRadar24 URL may be invalid without a callsign. | Validate identifier; hide invalid links (F4.6). |
| A15 | Low | Types | Position source is a raw number; response tuples are not validated. | **Resolved 2026-11-12 (M1.2):** typed `Aircraft` model, epoch-ms timestamps, defensive tuple parsing; position source is not exposed. |
| A16 | Low | Repo | Empty `src/{components,hooks,types,utils}` directory; missing `/plane.svg`; no tests/lint/CI. | **Partially resolved 2026-11-12:** directory removed, 401 tests and production build added; favicon and lint/CI remain. |
| A17 | Low | Mobile | Sidebar is a cramped 40vh panel; map may need resize invalidation. | Bottom sheet and resize handling (F8.3). |
| A18 | Low | A11y | Icon-only buttons lack accessible names; no focus styling documented. | **Partially resolved 2026-11-12:** status banner and settings controls labelled; visible focus rings added. Full pass in M4 (F9). |

---

## 10. Open questions and out of scope

### Open questions

- Default units: aviation or metric?
- Whether to add community providers after OpenSky proves insufficient, or stay
  OpenSky-only.
- Whether to request OpenSky `extended=1` for aircraft category data.
- Whether to keep the FlightRadar24 link as the only external lookup.
- Maximum aircraft count to render before clustering or capping.
- Whether a light theme is in scope for the restart or later.
- Directional View mode: keep the 60° cone fixed or make the angle configurable?
- Localization and time-zone display.

### Explicitly out of scope

- Per-aircraft distance, bearing, elevation angle, and overhead-pass prediction
  in the core list/detail UI. **Planned exception (M3.5):** the directional View
  cone described in section 1.4.
- Location search, geocoding, GPS, and radius controls (removed in M2.0;
  perimeter-only).
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
| 2026-11-12 | **M1 implemented:** typed config/settings, provider model + OpenSky adapter/registry, cadence/credit budget, backoff, single-flight cancellation, last-good data, status banner, panel retention, data age/provider header, refresh-settings popover. A2–A4, A10, A12, A15 resolved; A16/A18 partially resolved. 261 tests, production build, and manual matrix pass. |
| 2026-11-12 | **Planned scope:** M2.0 removes location/geocoding/GPS/radius (perimeter-only default); M3.5 adds an optional directional View mode with pinned origin, bearing cone, and persisted visibility distance. Non-goals updated to scope the cone exception. |
| 2026-11-12 | **M2.0 implemented:** location tab/search/geocoding/GPS/radius removed; perimeter is the only mode and default; `FlightMap` simplified to the perimeter; copy and Toolbar tests updated. 265 tests, build, and a browser check (no off-scope requests, 136-aircraft fetch) pass. A11 resolved. Directional View (M3.5) remains future. |
| 2026-11-12 | **M3.5.3 implemented:** Perimeter/View toolbar switch, two-click origin/bearing picker, draggable origin pin that restarts the bearing step, translucent cone plus bearing line, cone auto-fit, and Clear semantics. 401 tests, typecheck, and build pass; Chrome verified pin/aim/drag/reload/Clear with no console errors. View query/filter and distance controls remain pending. |
