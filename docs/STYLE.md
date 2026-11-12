# Window Seat style guide (M5)

Window Seat follows the **Retro** reference: white/stone surfaces, hairline
borders, sky accents, active pills, faint hover motion, and a custom stroke icon
set. The secondary references contribute the Inter/Playfair pairing and
understated gradient accents.

## Theme model

- **Light by default, following the OS** through `prefers-color-scheme`.
- **No manual theme toggle.** `theme` in the workspace remains a stored value for
  future compatibility, but M5 renders from the OS preference.
- `color-scheme: light dark` is set on `:root`.
- Colours are stored as space-separated RGB channels (`--surface: 255 255 255`)
  so Tailwind opacity modifiers work: `bg-surface/80`, `border-warning/50`.
- Components use semantic Tailwind colour tokens. Raw palette values are only
  allowed in the token block, Leaflet overrides, and marker variables.

## Palette

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `bg` | `#fafaf9` stone-50 | `#0c0a09` stone-950 | App background |
| `surface` | `#ffffff` | `#1c1917` stone-900 | Toolbar, panel, popovers |
| `surface-2` | `#f5f5f4` stone-100 | `#292524` stone-800 | Controls, cards, chips |
| `border` | `#e7e5e4` stone-200 | `#44403c` stone-700 | Hairlines |
| `border-strong` | `#d6d3d1` stone-300 | `#57534e` stone-600 | Hover borders, handles |
| `ink` | `#292524` stone-800 | `#f5f5f4` stone-100 | Primary text |
| `muted` | `#6f6862` | `#a8a29e` stone-400 | Secondary text |
| `faint` | `#736c66` | `#9a938d` | Provider line, placeholders |
| `accent` | `#0ea5e9` sky-500 | `#38bdf8` sky-400 | Focus/ring, decorative accents |
| `accent-strong` | `#0369a1` sky-700 | `#0369a1` sky-700 | Active pill background |
| `accent-ink` | `#0369a1` sky-700 | `#7dd3fc` sky-300 | Accent text |
| `accent-soft` | `#e0f2fe` sky-100 | `#0c4a6e` sky-900 | Tags, selected surfaces |
| `success` / `-ink` / `-soft` | emerald | emerald | Success states |
| `warning` / `-ink` / `-soft` | amber | amber | Selected/stale/rate-limit |
| `danger` / `-ink` / `-soft` | red | red | Errors/offline |

Small text meets **WCAG AA** (4.5:1); large/bold text meets 3:1. The
`npm run a11y:check` harness measures both themes.

## Typography

| Role | Font | Notes |
| --- | --- | --- |
| UI | **Inter** | 400/500/600/700, system fallback |
| Wordmark and section titles | **Playfair Display** | 500/600/700; panel heading and popover titles |
| Telemetry | **JetBrains Mono** | Callsigns, ICAO24, altitude/speed/heading; `tabular-nums` |

Scale in use: 10 px uppercase labels, 11–13 px secondary/body, 14 px list
callsigns, 16–18 px section titles, 20 px wordmark. Uppercase labels use
`tracking-[0.08em]`.

## Spacing, radii, motion

- 4 px spacing rhythm via Tailwind (`gap-1` … `gap-4`, `px-4`, `py-3`).
- Radii: `rounded-lg` controls/chips, `rounded-xl` cards, `rounded-2xl`
  popovers/mobile sheet, `rounded-full` pills and badges.
- Shadows: `shadow-hairline` toolbar, `shadow-card` selected-flight card,
  `shadow-pop` popovers.
- Motion: 150–200 ms transitions; buttons lift 1 px on hover; saved items scale
  `1 → 1.01`; popovers use `animate-pop-in`; mobile sheets use
  `animate-sheet-up`. Reduced motion collapses all durations.

## Component patterns

- **Toolbar**: stone surface, hairline bottom border, segmented mode pills.
  Active mode is `accent-strong` with white text. Clear/Refresh/Saved/Settings
  share the same bordered button shape; mobile collapses labels to icons.
- **Rows**: full-width buttons with a 2 px transparent left border. Hover uses
  `surface-2`; selection uses a warning left border and a 50%-opacity warning
  surface. Callsigns and telemetry use monospace/tabular numerals. A fixed-width
  origin flag slot precedes the callsign; unknown origins use a neutral globe.
- **Detail card**: boarding-pass treatment — dashed perforation, mono callsign,
  “Likely from” city/airport, aircraft type, and airline when available, then
  the 2-column telemetry grid and accent FlightRadar24 link. Route metadata is
  labelled as a scheduled/probable route.
- **Flight panel**: on desktop it is a rounded, elevated card with 12 px gaps on
  the top, right, and bottom, floating over the map. Map auto-fit reserves the
  panel width, and the attribution is offset clear of it. On mobile it remains a
  bottom sheet.
- **Popovers**: white/stone panel with a hairline border and large shadow; a
  bottom sheet below 700 px with safe-area padding. Both trap focus and restore
  it on close.
- **Status banners**: tone-coloured left border + soft background + matching
  dark text; retry action inherits the tone.

## Icons

`src/components/icons.tsx` provides stroke-1.5 SVGs: plane, target, view cone,
search, refresh, close, settings, bookmark, chevron, info, alert triangle,
offline, clock. Icons are `aria-hidden`; buttons keep text or an explicit
`aria-label`.

## Map and markers

- **Tiles**
  - Light: OpenStreetMap standard tiles.
  - Dark: OSM tiles with an inverted/hue-rotated tile-pane filter. CARTO's
    `dark_all` endpoint now renders an “API KEY REQUIRED” watermark without a
    key, so M5 keeps the OSM attribution and filters locally. Marker/overlay
    panes are not filtered.
  - The tile-pane class is toggled on Leaflet's live container, so an OS theme
    change updates the map without a reload.
  - Attribution uses the same white/stone surface in both themes and is offset
    clear of the floating desktop panel.
- **Marker glyph**: 32 px north-up SVG plane, rotated to the reported track.
  Zoom-aware scale: `0.85` below zoom 8, `1` at 8–9, `1.05` at 10–11, `1.15`
  at 12+; selected markers multiply by `1.3`.
- **Two-tone contrast**: altitude-coloured fill with a theme-aware stroke
  (`--marker-stroke`) and halo (`--marker-halo`). Selected markers add a
  theme-aware ring (`.plane-glyph--selected`).
- **Stale treatment**: opacity `0.5` unselected, `0.7` selected. Colour and
  heading remain visible.
- **Cardinal headings** 0/90/180/270 are covered by `npm run style:check`.

## Accessibility guardrails

- Focus is never removed globally; `:focus-visible` uses a 2 px accent ring.
- Popovers trap Tab and return focus to their trigger.
- Keyboard map selection: arrows pan, Enter selects the centre, Escape cancels.
- Live regions cover selection, filters, loading, and status messages.
- `npm run a11y:check` verifies keyboard flow, focus wrapping, mobile sheet/map
  resize, and AA contrast in both themes.
- `npm run style:check` regenerates the light/dark live, empty, error, and stale
  screenshots; `docs/screenshots/before-*.jpg` preserves the pre-M5 comparison
  set.
