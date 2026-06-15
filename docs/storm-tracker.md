# Storm Tracker — Developer Documentation

Status: live on https://quynhonlife.com/storms (built and deployed June 2026).

This is the reference for the storm tracker feature. Read it before extending the
feature so you do not re-derive the hard-won bits (especially the GDACS endpoint
and the cache-busting rules).

## What it is

A Zoom Earth-style tropical cyclone tracker focused on Quy Nhon. Motivation: Quy
Nhon was hit by an unprecedented typhoon and residents stay anxious, so the page
defaults to a calm "all clear" and only raises alarm when a storm genuinely
threatens.

User-facing surface:
- **`/storms` page** — regional MapLibre map (South China Sea + W. Pacific). When a
  storm is active it shows the past track, forecast path, wind-impact cone, current
  category, and live distance/ETA to Quy Nhon, plus animated rain radar. When
  nothing is active it shows a calm "No storms threatening Quy Nhon" state.
- **Home-page storm banner** — a live announcement that appears whenever a cyclone
  is detected near Quy Nhon: red `warning` and amber `watch` for genuine threats,
  calm slate `monitor` for a storm in the basin that is not heading our way (hidden
  only at `none`). Shows the storm's current distance + compass direction and ETA,
  plus a "Live · updated X ago" line that re-stamps every minute so it reads as a
  live feed. Links to `/storms`. Preview it with no live storm via `/?storm=warning`
  (or `watch` / `monitor`).
- **Discoverability** — a "Storm Tracker" card in the home "Explore Quy Nhon" section
  (first card), plus a footer link. The Explore grid is 3 cards (Storm Tracker,
  Business Directory, Boat Tours); the Beach Guide placeholder was removed.

## Files

Backend:
- `server/storm-monitor.js` — fetches GDACS, computes the threat to Quy Nhon,
  caches in memory, and runs the 30-min poller. The brain of the feature.
- `server/geo.js` — `haversine()` + `bearingTo()` (lifted from spot.html).
- `server/index.js` — the `/storms` clean-URL route, the `/api/storms` route, and
  the `startStormMonitor()` kickoff (next to startCleanup/startHealthMonitor).

Frontend:
- `public/storm.html` — the storm page (home-page archetype: shared style.css +
  ES modules + i18n, so it gets all 5 languages).
- `public/js/storm.js` — own MapLibre instance, layers, radar animation, status
  hero, meta grid, controls. Imports `./i18n.js?v=NN`.
- `public/js/app.js` — `fetchStorms()` + `renderStormBanner()` drive the home banner.
- `public/js/i18n.js` — `storm_*` keys, added via `Object.assign(translations.xx, {...})`
  after the main blocks, for all 5 languages.
- `public/css/style.css` — `.storm-status`, `.storm-meta`, `.storm-banner`,
  `.storm-*` map controls/markers, `#storm-map` height, the `[hidden]` reset.

## Data sources (all free, no API key)

### GDACS (tropical cyclone track + forecast + cone) — READ THIS

GDACS is the UN/EU Global Disaster Alert system. It covers the Western Pacific
basin that hits Vietnam (NOAA's hurricane center does NOT cover us).

**Critical: use the EVENTS4APP endpoint, not MAP or SEARCH.**
- `geteventlist/MAP?eventtypes=TC` returns currently-active TCs and works from a dev
  machine, but **404s from the production server's IP** (GDACS geo-routes by IP).
  This wasted real time on first deploy. Do not use it.
- `geteventlist/SEARCH?eventlist=TC` works from the server but returns **historical**
  storms (months old). Wrong data.
- `geteventlist/EVENTS4APP` works from the server, returns all currently-active GDACS
  events (every hazard type), each with `iscurrent`. We filter to `eventtype === 'TC'`
  and not-`iscurrent:false`. This is what `GDACS_EVENTLIST` points at.

Per-event geometry comes from each event's `url.geometry`
(`polygons/getgeometry?eventtype=TC&eventid=...&episodeid=...`), which DOES work
from the server. GDACS geometry quirk: a storm often has only ONE `Point` feature
(the current centre) plus many `LineString` (track) and dated `Polygon` (wind-buffer)
features. So threat sampling reads storm-centre positions from Point coords,
LineString vertices, AND Polygon centroids (see `normalizeStorm`), not just Points.

### Other sources
- **RainViewer** (`api.rainviewer.com/public/weather-maps.json`) — animated rain
  radar tiles, client-side, no key. Inserted UNDER the storm vectors.
- **MapTiler** `dataviz` style — the light, low-detail basemap for the storm map
  (same key as the boat map; the boat map uses `streets-v2`). Two separate MapLibre
  instances, never shared.
- **Open-Meteo** — local Quy Nhon conditions on the storm page (the "Now in Quy Nhon"
  strip). Same feed as the home weather bar.

## `/api/storms` response shape

```
{
  active: boolean,                 // a relevant storm is in/near the basin
  updatedAt: ISO string,
  quyNhon: { lat: 13.77, lng: 109.22 },
  threat: { level, distanceKm, etaHours, currentDistanceKm, closestAt, bearing },
  storm: {                         // null when active=false
    eventid, name, alertlevel, windKmh, category,
    current: { lat, lng },
    bbox: [minLng, minLat, maxLng, maxLat],
    pastTrack:     GeoJSON FeatureCollection (LineStrings, forecast=false),
    forecastTrack: GeoJSON FeatureCollection (LineStrings, forecast=true),
    cone:          GeoJSON FeatureCollection (Polygons, props.sev green/orange/red),
    points:        GeoJSON FeatureCollection (Point positions),
    threat:        same shape as top-level threat
  } | null,
  others: [ { name, alertlevel, category, distanceKm } ]   // non-primary storms (currently unused in UI)
}
```
The GeoJSON fields are ready to `source.setData()` directly. The frontend reads this
one endpoint for both the page and the banner.

## Threat logic (`server/storm-monitor.js`)

- Quy Nhon = `13.77 N, 109.22 E`.
- Basin pre-filter: lng 99..170, lat -5..45 (catches genesis east of the Philippines).
- Closest-approach = min haversine over all sampled storm-centre positions.
- ETA = timestamp of the nearest FUTURE forecast position (null if the storm is
  already past, e.g. a dissipating system).
- Grade bands (tunable in `gradeThreat`):
  - `warning` (red banner): closest < 200 km within ~72h, OR GDACS Red affecting VN / < 400 km.
  - `watch` (amber banner): closest < 500 km within ~120h, OR GDACS Orange in region.
  - `monitor`: a storm is in the basin but not a near threat (calm slate banner +
    the page; informs and reassures rather than alarms).
  - `none`: nothing relevant (page shows all-clear, banner hidden).
- Primary storm = smallest closest-approach distance. `others[]` holds the rest.
- `threat` also carries `currentBearing` (compass direction of the storm's current
  position from Quy Nhon) for the banner headline, alongside `bearing` (to closest point).

### Refresh cadence (adaptive)
The monitor polls GDACS every 30 min when the basin is clear and every 10 min while a
storm is active (cache TTL 20 / 8 min), so the banner stays live during an event without
hammering the API when nothing is happening. The home banner re-fetches every 5 min and
re-stamps its "updated X ago" line every minute.

### Preview / demo mode
With no live storm you cannot see the banner or a populated map. `/api/storms?demo=LEVEL`
(`warning` | `watch` | `monitor`) returns a synthetic but realistic snapshot — including a
generated past/forecast track — that **bypasses the cache and is never produced by the real
poller**. The pages forward it from their own URL: `/?storm=warning` drives the home banner,
`/storms?storm=warning` drives the map. Ordinary visitors never trigger it.

## Map rendering (`public/js/storm.js`)

- Own MapLibre instance, container `#storm-map`, light `dataviz` style, regional
  default view `center [118,15] zoom 4.2`.
- On active storm: `fitBounds()` to the storm bbox + Quy Nhon so both are always framed.
- Layer order (bottom to top): RainViewer raster (inserted before `storm-cone-fill`),
  cone fill + outline, past track (solid grey), forecast track (dashed red). HTML
  markers (Quy Nhon dot, spinning storm centre) sit on top.
- Radar animates by `setTiles()` across RainViewer frames; the radar toggle button
  pauses it.
- Controls: Focus Quy Nhon (flyTo), Whole storm (re-fitBounds), radar toggle.

## i18n

All `storm_*` strings live in `public/js/i18n.js`, added via
`Object.assign(translations.en/vi/ko/zh/ja, {...})` after the main translation
object. English and Vietnamese are solid; Korean/Chinese/Japanese are best-effort and
worth a native-speaker review before relying on them.

## Related weather change (not the storm tracker, but done in the same work)

The home weather bar is fed by Open-Meteo. Two changes:
1. Pinned the model from `best_match` to **GFS** (`&models=gfs_seamless` in
   `fetchWeather` in `server/index.js`). best_match's auto-blend was the lone outlier
   falsely escalating dry, clear days to "thunderstorm". GFS is the only named model
   that still returns `visibility`, which the sunset prediction needs.
2. Removed the sky-condition icon and word from the bar entirely. Free forecast
   models cannot reliably classify the current sky (they over-read cloud / over-call
   storms); paid outlets like AccuWeather blend real observations to fix that. So the
   bar now shows only the reliable fields: temperature, wind, humidity, waves,
   sunrise. If you ever want an accurate sky condition, it needs real observations
   (satellite or a paid API), not another model swap.

## Deploy

Repo `github.com/clubbah/quynhon-boat-app`, branch `master`. Server: Hetzner
`5.78.191.155`, code at `/opt/quynhon-boat-app`, PM2 process `vessel-tracker` (port
3001), behind Coolify + Cloudflare. SSH is key-based.

```
# local
git add <files> && git commit && git push origin master
# server
ssh root@5.78.191.155 "cd /opt/quynhon-boat-app && git pull origin master && pm2 restart vessel-tracker --update-env"
```
- Server JS change (`server/*.js`) needs the pm2 restart. Static-only change
  (`public/*`) just needs `git pull` (Express serves from disk).
- Cache-bust: bump `?v=` on any changed `public/js/*` or `public/css/*` AND in
  `public/sw.js` PRECACHE_URLS, and bump `CACHE_NAME`.

### Current asset versions (keep in sync)
- `app.js?v=34`, `storm.js?v=7`, `style.css?v=29`, `i18n.js?v=31`, `vessel-card.js?v=3`
- `sw.js` `CACHE_NAME = 'qnl-v43'`
- `map.js` is unversioned (busted only by the CACHE_NAME bump).

## Gotchas / lessons (the expensive ones)

1. **GDACS MAP 404s from the server IP.** Use EVENTS4APP. See above.
2. **i18n.js was imported without a version**, so Cloudflare's `max-age=14400` and the
   service worker served a stale copy missing new keys (the page showed raw key names
   like `storm_clear_title`). Fix: every importer of `i18n.js` (app.js, vessel-card.js,
   storm.js) must use the SAME `?v=NN`, or you get duplicate module instances and
   broken language switching. When you change i18n.js, bump that version in all three.
3. **`#storm-map` had zero height** because the stylesheet rule was `#map { height:100% }`
   only. Fixed to `#map, #storm-map { ... }`. A new map container needs its own height.
4. **The `[hidden]` attribute loses to `display:grid/flex`.** Added a global
   `[hidden] { display: none !important; }` so `el.hidden = true` actually hides.
5. **MapLibre `Marker`: call `setLngLat()` before `addTo()`** or `addTo` throws on
   an undefined position.
6. **`/api/` is excluded from caching** (robots Disallow, SW skip, Cloudflare DYNAMIC),
   so live data stays live. Don't add caching there.
7. The home `renderPulseTimeline` had a latent crash (replaced its own placeholder
   then dereferenced it). Fixed to recreate the placeholder. Unrelated to storms but
   fixed in the same work.
8. **Module-level state read at boot must be declared before the boot block.** `app.js`
   calls `translatePage()` at load for non-English visitors, and that reads the
   module-level `lastStormData`. The `let` originally lived near the bottom of the file,
   so a non-English first load hit a temporal-dead-zone `ReferenceError` and the whole
   boot halted (blank page for vi/ko/zh/ja users). Fixed by hoisting `lastStormData` to
   the top with the other state. Watch for this any time boot-time code touches a
   `let`/`const` declared lower in the module. The banner demo (`/?storm=warning`) plus a
   language switch is the fastest way to catch it.

## Ideas / future work

- **Multi-storm UI.** `/api/storms` already returns `others[]`; the page only shows
  the primary. Could list secondary basin storms.
- **Push / email alerts.** Currently banner-only. The infra exists (Resend + ntfy.sh
  in `health-monitor.js`); a storm-poller could fire on threat transitions. Would need
  a subscription mechanism for residents (web push via the existing service worker is
  the cleanest).
- **Finer forecast detail.** GDACS is coarse. JTWC/JMA give tighter forecast cones if
  you want more precision (harder formats).
- **Satellite cloud layer** (NASA GIBS) for a richer Zoom-Earth look.
- **Native-speaker review** of the KO/ZH/JA storm strings.
- **Tune threat bands** in `gradeThreat` once you observe a real storm season.
