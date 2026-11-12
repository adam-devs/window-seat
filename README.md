# Window Seat ✈️

A lightweight flight tracker using the [OpenSky Network API](https://openskynetwork.github.io/opensky-api/rest.html).

## Features

- **Location mode** — search any city or use your GPS, set a radius (50–500 km)
- **Perimeter mode** — click two corners on the map to draw a custom bounding box
- Live plane markers that rotate to their heading
- Sidebar flight list with altitude, speed, vertical rate, heading, squawk
- Auto-refreshes every 15 seconds (respects OpenSky free tier rate limits)
- Click any plane on the map or in the list for the detail card
- "View on FlightRadar24" link for each selected flight

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Performance check

With the dev server running, exercise the map with 300 synthetic aircraft:

```bash
npm run perf:check
```

The harness drives a synthetic OpenSky response, forces repeated snapshots,
and reports desktop/mobile frame rate, the largest marker jump, heap growth, and
bounded DOM/trail counts. It uses Google Chrome via Playwright:

- `PERF_AIRCRAFT` (default 300)
- `PERF_DESKTOP_FPS` / `PERF_MOBILE_FPS`
- `PERF_MAX_JUMP_PX`
- `PERF_MAX_HEAP_MB`
- `PERF_BASE_URL` (default `http://localhost:5173/`)
- `PERF_CHANNEL` (default `chrome`)

## View-mode check

With the dev server running, verify the directional View interaction against
deterministic synthetic aircraft:

```bash
npm run view:check
```

The harness runs desktop and mobile viewports in Google Chrome and checks
pin/bearing filtering, marker/list parity, one request per selection change,
aborted superseded requests, keyboard distance and Escape behavior, persisted
reload state, and the empty-direction copy. Useful overrides:

- `VIEW_BASE_URL` (default `http://localhost:5173/`)
- `VIEW_REQUEST_DELAY_MS` (default `350`)
- `VIEW_CHANNEL` (default `chrome`)

## Saved-library check

With the dev server running, verify the saved areas/views library:

```bash
npm run saved:check
```

The harness covers two saved perimeters plus one View, reload and restore,
rename/delete persistence, v1 workspace migration, the 30-entry cap with invalid
entries, and the mobile popover layout. It uses Google Chrome via Playwright:

- `SAVED_BASE_URL` (default `http://localhost:5173/`)
- `SAVED_CHANNEL` (default `chrome`)

## Mobile/accessibility check

With the dev server running, verify the keyboard flow, popover focus, mobile
bottom sheet, map resizing, and text contrast:

```bash
npm run a11y:check
```

The harness uses Google Chrome via Playwright:

- `A11Y_BASE_URL` (default `http://localhost:5173/`)
- `A11Y_CHANNEL` (default `chrome`)

Keyboard use: focus the map and use the arrow keys to pan; press Enter to place
a perimeter corner or pin/aim the View at the map centre; press Escape to cancel.

## Flight enrichment check

Flight rows and the detail card show a flag for the **origin airport country**
plus the likely origin city/airport, airline when available, and aircraft type.
Metadata comes from the
keyless [adsbdb](https://www.adsbdb.com/) API through the local `/adsbdb` Vite
proxy, with visible-row lookups, a bounded persistent cache, and a neutral globe
when no route is known. The route is callsign-based and scheduled/probable, not
a confirmed observation.

With the dev server running:

```bash
npm run enrich:check
```

The harness mocks OpenSky and adsbdb, then verifies visible-row requests,
flag/route/type rendering, unknown fallbacks, and cache reuse across refresh and
reload. It uses Google Chrome via Playwright:

- `ENRICH_BASE_URL` (default `http://localhost:5173/`)
- `ENRICH_CHANNEL` (default `chrome`)

## Visual/style check

With the dev server running, regenerate the theme screenshots and verify the
style tokens, map tile source, and cardinal marker headings:

```bash
npm run style:check
```

Outputs `docs/screenshots/{light,dark}-{live,empty,error,stale}.jpg`; the
pre-M5 comparison set lives alongside it as `before-{state}.jpg`. It uses
Google Chrome via Playwright:

- `STYLE_BASE_URL` (default `http://localhost:5173/`)
- `STYLE_CHANNEL` (default `chrome`)

The design tokens, typography, component patterns, and map/marker decisions are
documented in `docs/STYLE.md`.

## Data sources

- **OpenSky Network** — live state vectors through the local `/opensky` proxy.
- **adsbdb** — keyless aircraft/route metadata through the local `/adsbdb`
  proxy. No credentials are used.

## Notes on the OpenSky API

- The app is intended to run **locally** via `npm run dev`.
- OpenSky now requires OAuth2 client credentials; basic auth is no longer
  supported.
- Anonymous access works but is limited (400 credits/day per IP).
- The Vite dev server proxies `/opensky` → `https://opensky-network.org` to avoid
  CORS, and injects your bearer token server-side.
- For production you would need your own proxy; that is out of scope here.

### Adding OpenSky credentials (recommended)

1. Log in at [opensky-network.org](https://opensky-network.org) and create an API
   client on your Account page.
2. Copy `.env.example` to `.env.local` and fill in:

```bash
OPENSKY_CLIENT_ID=your-client-id
OPENSKY_CLIENT_SECRET=your-client-secret
```

Do not use the `VITE_` prefix: these values stay in the Vite dev server and are
never included in the browser bundle. `.env.local` is gitignored.

The proxy fetches and refreshes an OAuth2 token automatically. If credentials
are missing or the token request fails, the app falls back to anonymous access.

## Project Structure

```
src/
  components/
    FlightMap.tsx      ← Leaflet map, plane markers, perimeter drawing
    FlightPanel.tsx    ← Sidebar with flight list and detail card
    Toolbar.tsx        ← Mode switcher, search, radius slider
  hooks/
    useFlights.ts      ← Data fetching + auto-refresh
  utils/
    opensky.ts         ← API call, parsing, unit conversions, bbox helpers
  types/
    index.ts           ← TypeScript interfaces
  App.tsx              ← Root component, state management
  app.css              ← All styles (CSS variables at top for easy theming)
```

## Customising the Look

All colours and spacing live at the top of `src/app.css` as CSS variables:

```css
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --accent: #3b82f6;
  /* … */
}
```

Swap these out and the whole UI updates instantly.
