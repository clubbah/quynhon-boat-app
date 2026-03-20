# Quy Nhon Vessel Tracker — Design Spec

## Overview

A real-time vessel tracking web app for Quy Nhon, Vietnam. Shows live positions of ships in the harbor and offshore on an interactive map, with detailed vessel information and recent movement tracks. Bilingual (English/Vietnamese). Responsive for both desktop and mobile.

## Data Source

**aisstream.io** — free real-time AIS data via WebSocket. The backend subscribes with a geographic bounding box around Quy Nhon (~13.5–14.0 lat, 109.0–109.5 lng) and receives position reports and static vessel data as they arrive.

## Architecture

Three components:

### 1. Backend Server (Node.js + Express + ws)

- Connects to aisstream.io via WebSocket on startup
- Parses incoming AIS messages (position reports + static/voyage data)
- Upserts vessel state into SQLite
- Appends position history to SQLite
- Relays parsed vessel updates to all connected browser clients via its own WebSocket server
- Runs periodic cleanup: prunes position history older than 6 hours, removes vessels not seen in 6+ hours
- REST endpoint: `GET /api/vessels/:mmsi/track` — returns position history for a single vessel
- On new browser WebSocket connection: sends a full snapshot of all current vessels from SQLite so the client can render the map immediately
- API key for aisstream.io stored as environment variable (`AISSTREAM_API_KEY`)

### 2. SQLite Database

**Table: vessels** (one row per vessel, upserted on each update)

| Column | Type | Description |
|--------|------|-------------|
| mmsi | TEXT PK | Maritime Mobile Service Identity |
| imo | TEXT | IMO number |
| name | TEXT | Vessel name |
| call_sign | TEXT | Radio call sign |
| vessel_type | INTEGER | AIS vessel type code |
| vessel_type_label | TEXT | Human-readable type (cargo, tanker, etc.) |
| flag_country | TEXT | Flag state |
| length | REAL | Length in meters |
| width | REAL | Width in meters |
| draught | REAL | Draught in meters |
| destination | TEXT | Reported destination |
| eta | TEXT | Estimated time of arrival |
| lat | REAL | Current latitude |
| lng | REAL | Current longitude |
| speed | REAL | Speed over ground (knots) |
| course | REAL | Course over ground (degrees) |
| heading | REAL | True heading (degrees) |
| nav_status | INTEGER | Navigational status code |
| nav_status_label | TEXT | Human-readable status (underway, anchored, etc.) |
| updated_at | TEXT | ISO timestamp of last update |

**Table: position_history** (append-only, pruned to 6 hours)

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| mmsi | TEXT | Foreign key to vessels |
| lat | REAL | Latitude |
| lng | REAL | Longitude |
| speed | REAL | Speed at this point |
| course | REAL | Course at this point |
| timestamp | TEXT | ISO timestamp |

**Index:** `position_history(mmsi, timestamp)` for efficient track queries.

### 3. Frontend (HTML/CSS/JS + Leaflet)

Single-page app served by the Express backend.

**On load:**
1. Connects to backend WebSocket
2. Receives snapshot of all current vessels
3. Renders map centered on Quy Nhon bay (13.76, 109.23), zoom ~12
4. Places vessel markers on map

**On WebSocket message:**
- Updates or adds vessel markers in real-time

**On vessel click:**
1. Fetches track from `GET /api/vessels/:mmsi/track`
2. Opens info panel with essential info
3. Draws track polyline on map

## Vessel Markers

Directional arrow/triangle icons rotated to vessel heading. Color-coded by type:

| Color | Vessel Type |
|-------|-------------|
| Blue | Cargo / Container |
| Red | Tanker |
| Green | Passenger |
| Yellow | Fishing |
| Gray | Other / Unknown |

Vessel name appears on hover (tooltip).

## Info Panel

**Essential view** (always visible when panel is open):
- Vessel name
- Type (with icon)
- Flag country
- Speed (knots)
- Destination
- Navigational status (anchored, underway, moored, etc.)

**Expanded view** (toggle to show):
- Dimensions (length x width)
- Draught
- IMO number
- MMSI
- Call sign
- ETA
- Course and heading
- Last update time

## Track Display

- Fetched on vessel click from REST endpoint
- Drawn as a polyline with opacity gradient (more opaque = more recent)
- Cleared when panel is closed or another vessel is selected
- Up to 6 hours of history

## Top Bar

- App title: "Quy Nhon Vessel Tracker" / "Theo Dõi Tàu Quy Nhơn"
- Vessel count badge (e.g., "24 vessels")
- Language toggle button (EN / VI)
- Vessel type filter dropdown

## Responsive Layout

- **Desktop:** Map fills viewport. Info panel as a right sidebar (~350px wide).
- **Mobile:** Map fills viewport. Info panel as a bottom sheet (slides up, half-screen).

## Internationalization

Bilingual English / Vietnamese. UI labels stored in a simple i18n object with `en` and `vi` keys. Language preference saved to localStorage.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| HTTP server | Express |
| WebSocket (upstream) | ws (client to aisstream.io) |
| WebSocket (downstream) | ws (server to browsers) |
| Database | better-sqlite3 |
| Map | Leaflet + OpenStreetMap tiles |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Deployment | Any Node.js host (Render, Railway, Fly.io free tier) |

## Bounding Box

Quy Nhon area filter for aisstream.io subscription:
- Southwest: 13.5, 109.0
- Northeast: 14.0, 109.5

This covers the Quy Nhon port, bay, and offshore approaches.

## Cleanup Schedule

- Every 10 minutes: delete position_history rows older than 6 hours
- Every 10 minutes: delete vessels not updated in 6+ hours

## Out of Scope (for now)

- User accounts or authentication
- Vessel photos
- Weather overlay
- AIS message types beyond position reports and static/voyage data
- DIY SDR radio receiver integration
- Notifications or alerts
