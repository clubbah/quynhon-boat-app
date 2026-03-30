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
- **Weather:** Open-Meteo free API (no key needed)
- **Process manager:** PM2 on Hetzner

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
- **"What's That Boat?" feature** — point phone at vessel to identify it (GPS + compass, /spot page)
- **Weather bar** — temperature, conditions, wind, humidity, waves, sunrise/sunset, day/night icons
- **Port stats** — total vessels, underway, anchored, active today
- **Largest vessel** — highlights biggest vessel currently tracked
- **Recent activity table** — clickable vessel names zoom to map
- **5 languages** — English, Vietnamese, Korean, Chinese, Japanese (flag switcher)
- **Responsive** — desktop sidebar card, mobile bottom sheet, floating "ID a boat" button
- **Editorial design** — DM Serif Display masthead, editorial sections, sharp corners
- **Explore section** — Coming Soon cards for Eat & Drink, Beach Guide, Getting Around
- **Buoy/beacon filtering** — non-vessel AIS stations excluded
- **Fake MMSI filtering** — test transponders and junk data excluded

## Key Files
- `server/index.js` — Express server, WebSocket relay, weather/port-stats/AIS-feed APIs
- `server/ais-client.js` — Connects to aisstream.io WebSocket (fallback, not primary)
- `server/ais-types.js` — AIS message type definitions and vessel type mappings
- `server/db.js` — SQLite schema, upsert/query functions, buoy/fake MMSI filtering
- `server/cleanup.js` — Prunes stale vessels and old position history
- `public/index.html` — Main page (editorial portal layout)
- `public/spot.html` — "What's That Boat?" feature (GPS + compass vessel ID)
- `public/js/app.js` — Main app logic, WebSocket, weather, port stats, search, translations
- `public/js/map.js` — MapLibre map, GeoJSON vessel layer, tooltips, track, highlight
- `public/js/vessel-card.js` — Vessel detail popup card
- `public/js/vessel-icons.js` — Flag emojis, country names, color mappings
- `public/js/i18n.js` — 5-language translations (EN, VI, KO, ZH, JA)
- `public/css/style.css` — Editorial design, responsive layout
- `scripts/ais-relay.js` — Runs on RTL-SDR laptop, pushes AIS data to server every 60s

## Environment Variables
- `AISSTREAM_API_KEY` — API key for aisstream.io fallback (stored in .env, not committed)
- `AIS_FEED_SECRET` — Secret key for RTL-SDR relay endpoint
- `PORT` — Server port (default 3000)

## Commands
- `npm start` — Run the server
- `npm test` — Run tests (vitest)
- `npm run test:watch` — Watch mode tests

## RTL-SDR Setup (LIVE)
RTL-SDR USB dongle (RTL2832U+R820T2) connected to laptop on 26th floor condo, window-side, ocean-facing.

**Data flow:**
1. RTL-SDR receives AIS radio signals from vessels
2. AIS-catcher (C:\AIS-catcher.x64\start-ais.bat) decodes radio → vessel data
3. AIS-catcher serves data on localhost:8100
4. ais-relay.js (scripts/ais-relay.js) fetches from localhost:8100/api/ships.json every 60s
5. Relay pushes to https://quynhonlife.com/api/ais-feed/{secret}
6. Server stores in SQLite and broadcasts to browser clients via WebSocket

**Feed secret:** 9b63b8fc0e7d17224a6749c6456b8469 (set as AIS_FEED_SECRET in .env on server)
**Range:** ~50-70 km from 26th floor elevation (~80m), covering Quy Nhon bay and offshore.

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
- Hetzner server also runs Coolify (Docker) — vessel tracker runs alongside via PM2
- Nginx reverse proxies port 3000 to langs.ca
- Cloudflare handles DNS + SSL
  - langs.ca: A record → 5.78.191.155 (proxied). Only ONE A record!
  - quynhonlife.com: A record → 5.78.191.155 (ensure nameservers point to Cloudflare, not Hostinger)
- PM2 auto-restarts on crash: `pm2 startup` and `pm2 save` configured
- Cache busting: increment `?v=XX` on app.js and i18n.js imports when deploying JS changes

## Design Decisions
- **Editorial/magazine aesthetic** — DM Serif Display masthead, sharp corners, no border-radius pills
- **Color palette** — Teal primary (#0d9488), warm ink tones, white background
- **Fonts** — DM Serif Display (headings), Noto Sans (body — chosen for full Vietnamese/CJK diacritic support)
- **Speed-based vessel status** — Uses speed > 0.5kn to determine "underway" instead of AIS nav_status (crews forget to update their transponder)
- **Buoy/beacon filtering** — MMSI ranges 99x, 97x, 00x, 1111, 9999 filtered out as non-vessels
- **Fake MMSI filtering** — 123456789, type-0 unnamed vessels excluded

## Roadmap

### Phase 1: Vessel Tracker (DONE)
- ✅ Live vessel map with RTL-SDR
- ✅ What's That Boat? feature (GPS + compass, /spot page)
- ✅ Weather integration (Open-Meteo, day/night icons)
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
- ✅ Privacy policy + Terms of service
- ✅ Google Analytics
- ✅ Cloudflare Email Routing
- ✅ Favicon

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

### Future Monetization Ideas
- Sponsored business listings in directory
- Ad space for local businesses targeting tourists
- Premium vessel alerts (notify when specific ships arrive)
- Vessel photo database (exclusive 26th floor vantage point)
