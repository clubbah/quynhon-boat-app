# Quy Nhon Life

## Project Overview
Local lifestyle portal for Quy Nhon, Vietnam — starting with real-time vessel tracking, expanding into a city guide for tourists and locals.

**Live at:** https://quynhonlife.com
**Deployed on:** Hetzner VPS (5.78.191.155) via PM2 + Coolify proxy, SSL through Cloudflare
**Repo:** github.com/clubbah/quynhon-boat-app

## Architecture
- **Backend:** Node.js + Express + WebSocket server
- **Database:** SQLite (better-sqlite3) — vessels table + position history (pruned to 6 hours)
- **Data source:** RTL-SDR dongle → AIS-catcher → ais-relay.js → server (live AIS radio)
- **Frontend:** MapLibre GL JS (Streets style), vanilla JS, Noto Sans + DM Serif Display fonts
- **Map tiles:** MapTiler (key: CKY69E5ib1MMQDfWMRvg)
- **Weather:** Open-Meteo free API (no key needed) — current + hourly forecast + marine
- **Process manager:** PM2 on Hetzner (process name: `vessel-tracker`, port 3001)
- **Reverse proxy:** Coolify (Traefik-based) handles port 443 → localhost:3001
- **PWA:** Installable as home screen app on Android and iOS

## Current Features
- **Live vessel tracking** — ~60 vessels in Quy Nhon via RTL-SDR antenna
- **MapLibre GL JS map** — GeoJSON symbol layer, top-down ship silhouettes per type
- **Color-coded markers** — cargo=blue, tanker=red, passenger=green, fishing=yellow, other=gray
- **Hover tooltip** — country flag, vessel name, country name, type with colored dot
- **Click vessel** — popup card with speed, course, status, destination, ETA, dimensions, draught, IMO, MMSI, call sign
- **Vessel highlight** — orange ring on selected vessel
- **6-hour track history** — dashed gray line on click
- **Search** — find vessel by name or MMSI
- **Smooth zoom** — click or search flies to vessel
- **Type filter** — dropdown to filter by vessel type
- **Recenter button** — returns map to Quy Nhon port
- **Sunset Prediction** — proprietary scoring model using cloud layers, haze, humidity, precipitation. Ratings: Spectacular/Vivid/Nice/Ordinary. Tuned for tropical coastal conditions (clear sky + humidity = nice, not ordinary). Shows "This evening at HH:MM" or "Tomorrow at HH:MM" contextually. Info tooltip explains the model. Factor indicators (green/yellow/red dots). Updates every 15 min with weather data.
- **"What's That Boat?" feature** — overhauled with live mini-map showing pointing cone, continuous GPS via watchPosition, ±25° matching cone, compass calibration tip, reset/recalibrate button, haptic vibration feedback on match, compatible with Android and iOS
- **Weather bar** — temperature, conditions, wind, humidity, waves, sunrise, day/night icons (in info-row left column, translated)
- **Port stats** — total vessels, underway, anchored (3-column grid with hero numbers)
- **Largest vessel** — highlights biggest vessel currently tracked
- **Recent activity table** — clickable vessel names zoom to map
- **5 languages** — English, Vietnamese, Korean, Chinese, Japanese (flag switcher)
- **Responsive** — desktop sidebar card, mobile bottom sheet, floating "ID a boat" button, centered mobile layout
- **Editorial design** — DM Serif Display masthead, editorial sections, sharp corners
- **Explore section** — Coming Soon cards for Eat & Drink, Beach Guide, Getting Around
- **About section** — SEO-rich crawlable text about Quy Nhon Life (translated in all 5 languages)
- **Buoy/beacon filtering** — non-vessel AIS stations excluded
- **Fake MMSI filtering** — test transponders and junk data excluded
- **PWA** — installable as app via manifest.json + service worker, offline caching for static assets

## SEO
- **Google Search Console** — verified via Cloudflare, sitemap submitted
- **Bing Webmaster Tools** — verified via GSC import
- **Meta tags** — description, OG, Twitter Card on all pages (index, spot, privacy, terms)
- **Schema.org JSON-LD** — WebSite + TouristDestination structured data
- **Canonical URLs** — all pages point to quynhonlife.com
- **hreflang tags** — all 5 languages + x-default
- **robots.txt** — allows all crawlers + AI bots (GPTBot, ChatGPT, Anthropic, Perplexity), blocks /api/
- **sitemap.xml** — all 4 pages with hreflang annotations
- **llms.txt** — structured description for AI crawlers
- **Cloudflare AI bot blocking** — disabled (custom robots.txt serves instead)

## Key Files
- `server/index.js` — Express server, WebSocket relay, weather/port-stats/AIS-feed APIs (hourly cloud data for sunset prediction)
- `server/ais-client.js` — Connects to aisstream.io WebSocket (fallback, not primary)
- `server/ais-types.js` — AIS message type definitions and vessel type mappings
- `server/db.js` — SQLite schema, upsert/query functions, buoy/fake MMSI filtering
- `server/cleanup.js` — Prunes stale vessels and old position history
- `public/index.html` — Main page (editorial portal layout, SEO meta tags, Schema.org, PWA manifest)
- `public/spot.html` — "What's That Boat?" with live mini-map, pointing cone, continuous GPS
- `public/js/app.js` — Main app logic, WebSocket, weather, sunset prediction, port stats, search, translations
- `public/js/map.js` — MapLibre map, GeoJSON vessel layer, tooltips, track, highlight
- `public/js/vessel-card.js` — Vessel detail popup card
- `public/js/vessel-icons.js` — Flag emojis, country names, color mappings
- `public/js/i18n.js` — 5-language translations (EN, VI, KO, ZH, JA) including sunset, about, and spot strings
- `public/css/style.css` — Editorial design, responsive layout, sunset card, about section
- `public/manifest.json` — PWA manifest (name, icons, theme, shortcuts)
- `public/sw.js` — Service worker (cache-first for static, network-first for HTML/API)
- `public/robots.txt` — Search + AI crawler rules
- `public/sitemap.xml` — All pages with hreflang
- `public/llms.txt` — AI crawler site description
- `scripts/ais-relay.js` — Runs on RTL-SDR laptop, pushes AIS data to server every 60s

## Environment Variables
- `AISSTREAM_API_KEY` — API key for aisstream.io fallback (stored in .env, not committed)
- `AIS_FEED_SECRET` — Secret key for RTL-SDR relay endpoint
- `PORT` — Server port (default 3001 on production)

## Commands
- `npm start` — Run the server
- `npm test` — Run tests (vitest)
- `npm run test:watch` — Watch mode tests

## RTL-SDR Setup (LIVE)
RTL-SDR USB dongle (RTL2832U+R820T2) connected to a **separate laptop** on 26th floor condo, window-side, ocean-facing. This is NOT the development laptop — it's a dedicated antenna machine.

### How to Start Everything (from scratch)

**On the ANTENNA laptop (2nd laptop with RTL-SDR plugged in):**

**Window 1 — AIS-catcher:**
```
cd C:\AIS-catcher.x64
AIS-catcher.exe -N 8100
```
> IMPORTANT: The flag is `-N` (built-in web server), NOT `-H` (HTTP push to remote).
> `-H` is for pushing data to external URLs. `-N` starts the local web server on port 8100.
> Verify by opening http://localhost:8100 in a browser — you should see the AIS-catcher web viewer.

**Window 2 — Relay script (pushes data to quynhonlife.com):**
```
node -e "const http=require('http');const https=require('https');const SECRET='9b63b8fc0e7d17224a6749c6456b8469';function relay(){http.get('http://localhost:8100/api/ships.json',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const raw=JSON.parse(d);let ships;if(raw.ships)ships=raw.ships;else if(Array.isArray(raw))ships=raw.filter(x=>typeof x==='object');else ships=Object.values(raw).find(v=>Array.isArray(v))||[];console.log('[Relay]',ships.length,'ships');if(!ships.length)return;const body=JSON.stringify(ships);const req=https.request({hostname:'quynhonlife.com',path:'/api/ais-feed/'+SECRET,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>console.log('[Relay] Server:',res.statusCode));req.on('error',e=>console.error('[Relay] Push error:',e.message));req.write(body);req.end();}catch(e){console.error('[Relay] Parse error:',e.message)}})}).on('error',e=>console.error('[Relay] Fetch error:',e.message))}relay();setInterval(relay,60000);console.log('[Relay] Started...')"
```
> This one-liner handles all AIS-catcher response formats (object with .ships, flat array, etc.)
> You should see: `[Relay] 47 ships` then `[Relay] Server: 200` every 60 seconds.
> The website will show fewer than the relay count — buoys and fake MMSIs are filtered server-side.

**Both cmd windows must stay open.** Closing either stops the data flow.

**On the SERVER (Hetzner — automatic):**
The server auto-restarts via PM2. No action needed. Verify with: `ssh root@5.78.191.155 "pm2 list"`

### Data Flow
1. RTL-SDR receives AIS radio signals from vessels
2. AIS-catcher decodes radio → vessel data, serves on localhost:8100 (flag: `-N 8100`)
3. Relay script fetches from localhost:8100/api/ships.json every 60s
4. Relay pushes to https://quynhonlife.com/api/ais-feed/{secret}
5. Server stores in SQLite and broadcasts to browser clients via WebSocket

### Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| AIS-catcher runs but localhost:8100 doesn't load | Wrong flag (`-H` instead of `-N`) | Use `-N 8100` |
| Relay says "Fetch error" | AIS-catcher not running or wrong port | Check Window 1, verify localhost:8100 in browser |
| Relay says "Push error" | Antenna laptop has no internet | Check wifi/ethernet |
| Website shows no vessels | Relay not running | Check Window 2 on antenna laptop |
| Website shows "Last update Xm ago" | Relay stopped or laptop went to sleep | Re-open both windows |

**Feed secret:** 9b63b8fc0e7d17224a6749c6456b8469 (set as AIS_FEED_SECRET in .env on server)
**Range:** ~50-70 km from 26th floor elevation (~80m), covering Quy Nhon bay and offshore.
**Antenna laptop requires:** Node.js (v24.13.1 installed)

## Analytics
- **Google Analytics:** G-6Q874P6V67 (installed on index.html + spot.html)
- **Cloudflare Analytics:** Available via Cloudflare dashboard (free, no-cookie alternative)

## Email
- **hello@quynhonlife.com** — Cloudflare Email Routing → forwards to personal Gmail
- Reply via Gmail "Send as" alias using App Password

## Legal Pages
- `/privacy.html` — Privacy policy (covers GPS/compass for What's That Boat, no cookies beyond GA)
- `/terms.html` — Terms of service
- Both reference hello@quynhonlife.com for contact

## Deployment Notes
- Hetzner server runs Coolify (Docker) — vessel tracker runs alongside via PM2
- Coolify (Traefik) reverse proxies port 443 → localhost:3001
- Cloudflare handles DNS + SSL
  - quynhonlife.com: A record → 5.78.191.155 (proxied, nameservers point to Cloudflare)
- PM2 auto-restarts on crash: `pm2 startup` and `pm2 save` configured
- PM2 process name: `vessel-tracker`
- Cache busting: increment `?v=XX` on app.js, i18n.js, and style.css imports when deploying changes
- Current versions: app.js?v=21, i18n.js?v=21, style.css?v=21

## Design Decisions
- **Editorial/magazine aesthetic** — DM Serif Display masthead, sharp corners, no border-radius pills
- **Color palette** — Teal primary (#0d9488), warm ink tones, white background
- **Fonts** — DM Serif Display (headings), Noto Sans (body — chosen for full Vietnamese/CJK diacritic support)
- **Type scale (Major Third)** — 5 steps: 10px (xs/micro), 12px (sm/labels), 15px (base/body), 20px (lg/emphasis), 28px (xl/hero). CSS tokens: `--text-xs` through `--text-xl`
- **Layout: compact masthead** — logo + language flags only, weather bar moved into info-row
- **Layout: info-row** — weather + port stats (left) alongside sunset prediction (right), side-by-side on desktop, stacked on mobile
- **No redundant data** — each data point has exactly one home (vessel count in grid only, sunset time in sunset card only, sunrise in weather bar only)
- **Speed-based vessel status** — Uses speed > 0.5kn to determine "underway" instead of AIS nav_status (crews forget to update their transponder)
- **Buoy/beacon filtering** — MMSI ranges 99x, 97x, 00x, 1111, 9999 filtered out as non-vessels
- **Fake MMSI filtering** — 123456789, type-0 unnamed vessels excluded
- **Sunset prediction tuned for tropics** — Clear sky + high humidity at Quy Nhon coast = "Nice" (not "Ordinary"). Clouds boost to Vivid/Spectacular. Overcast >85% is the main penalty.
- **Spot page ±25° cone** — Wider than typical (±15°) to compensate for phone compass inaccuracy

## Roadmap

### Phase 1: Vessel Tracker (DONE)
- ✅ Live vessel map with RTL-SDR
- ✅ What's That Boat? feature (GPS + compass + live mini-map, /spot page)
- ✅ Sunset Prediction (proprietary scoring model, tropical-tuned)
- ✅ Weather integration (Open-Meteo, day/night icons, hourly cloud data)
- ✅ 5-language support (EN, VI, KR, ZH, JA with flag switcher)
- ✅ Editorial portal design with logo
- ✅ Port stats (speed-based movement detection)
- ✅ Recent activity table (clickable vessel names)
- ✅ Largest vessel highlight
- ✅ Vessel search by name/MMSI
- ✅ 6-hour position track history
- ✅ Selected vessel highlight ring
- ✅ Hover tooltips with country flag, name, type
- ✅ Explore Quy Nhon section (Coming Soon placeholders)
- ✅ About section (crawlable SEO content, 5 languages)
- ✅ Privacy policy + Terms of service
- ✅ Google Analytics
- ✅ Cloudflare Email Routing
- ✅ Favicon
- ✅ SEO (meta tags, OG, Schema.org, sitemap, robots.txt, llms.txt, hreflang, GSC, Bing)
- ✅ PWA (manifest, service worker, installable on Android + iOS)

### Phase 2: Business Directory
- Local restaurants, seafood spots, coffee shops
- Boat tours, diving shops
- Categories, search, map pins
- User reviews/ratings
- **Translation strategy:** Google Translate API for Vietnamese + Korean, DeepL API for Japanese + Chinese
- Both have 500,000 chars/month free tier = 1M total free characters/month
- Translate once on content creation, cache in database per language

### Phase 3: Beach Guide
- Best beaches in Quy Nhon area
- Swimming conditions, wave info
- Hidden coves and snorkeling spots
- Seasonal recommendations

### Phase 4: Getting Around
- Transport options (Grab, bus, motorbike rental)
- Routes to popular destinations
- Airport transfer info
- Local travel tips

### Phase 5: Content & Community
- Photo gallery (user-submitted + own photos from 26th floor)
- Blog/articles about Quy Nhon life
- Events and what's happening
- Community vessel notes/sightings

### Future Ideas
- Play Store listing via TWA (Trusted Web Activity)
- App Store listing via Capacitor wrapper
- OG social sharing image (1200x630 custom card)
- Sponsored business listings in directory
- Ad space for local businesses targeting tourists
- Premium vessel alerts (notify when specific ships arrive)
- Vessel photo database (exclusive 26th floor vantage point)
