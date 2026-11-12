# SkyWatch ✈️

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

## Notes on the OpenSky API

- **No API key needed** for anonymous access (max 100 requests/day, 1 req/10s).
- If you [register a free account](https://opensky-network.org/index.php?option=com_users&view=registration) you get 400 requests/day.
- The Vite dev server proxies `/opensky` → `https://opensky-network.org` to avoid CORS.  
  For production you'll need a lightweight backend proxy (e.g. a tiny Express/Fastify server or Cloudflare Worker).

### Adding OpenSky credentials (optional)

In `src/utils/opensky.ts`, change:
```ts
const res = await fetch(`/opensky/api/states/all?${params.toString()}`);
```
to:
```ts
const res = await fetch(`/opensky/api/states/all?${params.toString()}`, {
  headers: {
    Authorization: 'Basic ' + btoa('YOUR_USERNAME:YOUR_PASSWORD'),
  },
});
```

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
