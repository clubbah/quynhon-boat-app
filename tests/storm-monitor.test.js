import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The storm monitor keeps its cache in module state, so every test loads a
// fresh copy and talks to a fake GDACS.
const LIST_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP';
const geomUrl = (id) => `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${id}&episodeid=5`;

const T0 = Date.parse('2026-11-22T06:00:00Z');
const MIN = 60 * 1000;

// Shaped like the real EVENTS4APP response (checked 2026-11-22): one Point
// feature per event, every hazard type in one list.
const event = (type, id, name, lng, lat, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {
    eventtype: type, eventid: id, episodeid: 5, eventname: name, alertlevel: 'Green', iscurrent: 'true',
    url: { geometry: type === 'TC' ? geomUrl(id) : `https://www.gdacs.org/other/${id}` },
    affectedcountries: [], ...extra,
  },
});
const quake = event('EQ', 1500001, '', 142.1, 38.2);
const kalmaegi = event('TC', 1001300, 'KALMAEGI-26', 112.5, 13.5, { alertlevel: 'Red', affectedcountries: [{ iso2: 'VN', iso3: 'VNM' }] });
const farStorm = event('TC', 1001301, 'FUNG-WONG-26', 140.0, 15.0);
const atlantic = event('TC', 1001302, 'MELISSA-26', -60.0, 20.0);
const list = (...features) => ({ type: 'FeatureCollection', features });

// A storm 350 km east of Quy Nhon, observed an hour ago, forecast to pass close.
const geometry = (lng, lat) => ({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { polygondate: new Date(T0 - 60 * MIN).toISOString(), severitydata: { severity: 150 } } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng, lat], [lng - 2, lat], [lng - 3, lat + 0.2]] },
      properties: { forecast: true } },
  ],
});

let gdacs;      // url -> body, or an Error to throw, or a number for an HTTP status
let calls;
let storms;
let quietLogs;

function fakeFetch(url) {
  calls.push(url);
  const hit = gdacs.get(url);
  if (hit instanceof Error) return Promise.reject(hit);
  if (typeof hit === 'number') return Promise.resolve({ ok: false, status: hit, json: async () => ({}) });
  if (hit === undefined) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  return Promise.resolve({ ok: true, status: 200, json: async () => hit });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  gdacs = new Map();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  quietLogs = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
  vi.resetModules();
  storms = await import('../server/storm-monitor.js');
});

afterEach(() => {
  quietLogs.forEach((s) => s.mockRestore());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const later = (ms) => vi.setSystemTime(Date.now() + ms);

describe('storm snapshot: normal readings', () => {
  it('reports all clear when GDACS lists no tropical cyclone in the basin', async () => {
    gdacs.set(LIST_URL, list(quake, atlantic));
    const s = await storms.getStormSnapshot();
    expect(s).toMatchObject({ active: false, storm: null, threat: { level: 'none' } });
    expect(s.updatedAt).toBe(new Date(T0).toISOString());
    expect(s.refreshFailedAt).toBeUndefined();
    expect(calls).toEqual([LIST_URL]);          // no track is fetched for a storm in another ocean
  });

  it('reports a storm in the basin with its threat to Quy Nhon', async () => {
    gdacs.set(LIST_URL, list(quake, kalmaegi));
    gdacs.set(geomUrl(1001300), geometry(112.5, 13.5));
    const s = await storms.getStormSnapshot();
    expect(s.active).toBe(true);
    expect(s.storm.name).toBe('KALMAEGI');
    expect(s.threat.level).toBe('warning');
    expect(s.storm.windKmh).toBe(150);
    expect(storms.peekStormSnapshot()).toEqual(s);
  });

  it('serves the cached snapshot until its time is up', async () => {
    gdacs.set(LIST_URL, list(quake));
    await storms.getStormSnapshot();
    later(10 * MIN);
    await storms.getStormSnapshot();
    expect(calls).toHaveLength(1);
    later(11 * MIN);                             // past the 20-minute calm TTL
    await storms.getStormSnapshot();
    expect(calls).toHaveLength(2);
  });
});

describe('storm snapshot: a failed fetch must never read as "no storms"', () => {
  it('gives no answer at all when the storm track cannot be loaded and there is no earlier reading', async () => {
    gdacs.set(LIST_URL, list(quake, kalmaegi));
    gdacs.set(geomUrl(1001300), new Error('fetch failed'));
    const s = await storms.getStormSnapshot();
    expect(s).toBeNull();                        // /api/storms answers 503 "unavailable"
    expect(storms.peekStormSnapshot()).toBeNull();
  });

  it('keeps the last good reading, with its old time, when a later refresh fails', async () => {
    gdacs.set(LIST_URL, list(quake, kalmaegi));
    gdacs.set(geomUrl(1001300), geometry(112.5, 13.5));
    const good = await storms.getStormSnapshot();

    later(9 * MIN);                              // past the 8-minute TTL of an active storm
    gdacs.set(geomUrl(1001300), 502);
    const stale = await storms.getStormSnapshot();
    expect(stale.active).toBe(true);
    expect(stale.storm.name).toBe('KALMAEGI');
    expect(stale.threat).toEqual(good.threat);
    expect(stale.updatedAt).toBe(good.updatedAt);            // not re-stamped as fresh
    expect(stale.refreshFailedAt).toBe(new Date(T0 + 9 * MIN).toISOString());
    expect(storms.peekStormSnapshot()).toEqual(stale);
  });

  it('does not turn a tracked storm into all clear when every track fetch fails', async () => {
    gdacs.set(LIST_URL, list(kalmaegi, farStorm));
    gdacs.set(geomUrl(1001300), geometry(112.5, 13.5));
    gdacs.set(geomUrl(1001301), geometry(140.0, 15.0));
    await storms.getStormSnapshot();
    later(9 * MIN);
    gdacs.set(geomUrl(1001300), new Error('timeout'));
    gdacs.set(geomUrl(1001301), new Error('timeout'));
    const s = await storms.getStormSnapshot();
    expect(s.active).toBe(true);
    expect(s.threat.level).toBe('warning');
  });

  it('does not drop the one storm whose track failed and report on the others', async () => {
    // Before the fix the nearer storm vanished and the far one became "the" storm.
    gdacs.set(LIST_URL, list(kalmaegi, farStorm));
    gdacs.set(geomUrl(1001300), new Error('fetch failed'));
    gdacs.set(geomUrl(1001301), geometry(140.0, 15.0));
    expect(await storms.getStormSnapshot()).toBeNull();
  });

  it('treats an empty or malformed event list as a failure, not a calm ocean', async () => {
    for (const body of [list(), {}, { features: null }, { error: 'Service unavailable' }]) {
      vi.resetModules();
      storms = await import('../server/storm-monitor.js');
      gdacs.set(LIST_URL, body);
      expect(await storms.getStormSnapshot()).toBeNull();
    }
  });

  it('keeps the last good reading when the event list itself cannot be fetched', async () => {
    gdacs.set(LIST_URL, list(quake));
    const good = await storms.getStormSnapshot();
    later(21 * MIN);
    gdacs.set(LIST_URL, 503);
    const s = await storms.getStormSnapshot();
    expect(s).toMatchObject({ active: false, updatedAt: good.updatedAt });
    expect(s.refreshFailedAt).toBeDefined();
  });

  it('goes back to a normal fresh reading once GDACS answers again', async () => {
    gdacs.set(LIST_URL, list(quake, kalmaegi));
    gdacs.set(geomUrl(1001300), geometry(112.5, 13.5));
    await storms.getStormSnapshot();
    later(9 * MIN);
    gdacs.set(geomUrl(1001300), 502);
    await storms.getStormSnapshot();
    later(3 * MIN);
    gdacs.set(geomUrl(1001300), geometry(111.0, 13.6));
    const s = await storms.getStormSnapshot();
    expect(s.refreshFailedAt).toBeUndefined();
    expect(s.updatedAt).toBe(new Date(T0 + 12 * MIN).toISOString());
    expect(s.storm.current.lng).toBe(111.0);
  });
});

describe('storm snapshot: staying light on GDACS', () => {
  it('waits two minutes after a failed refresh before asking again', async () => {
    gdacs.set(LIST_URL, 503);
    await storms.getStormSnapshot();
    await storms.getStormSnapshot();
    later(1 * MIN);
    await storms.getStormSnapshot();
    expect(calls).toHaveLength(1);
    later(1.5 * MIN);
    await storms.getStormSnapshot();
    expect(calls).toHaveLength(2);
  });

  it('shares one refresh between callers that ask at the same moment', async () => {
    gdacs.set(LIST_URL, list(quake, kalmaegi));
    gdacs.set(geomUrl(1001300), geometry(112.5, 13.5));
    const [a, b, c] = await Promise.all([storms.getStormSnapshot(), storms.getStormSnapshot(), storms.getStormSnapshot()]);
    expect(calls).toHaveLength(2);               // one list, one track
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('puts a time limit on every request to GDACS', async () => {
    gdacs.set(LIST_URL, list(quake));
    await storms.getStormSnapshot();
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('demo snapshots', () => {
  it('never enter the cache', async () => {
    expect(storms.buildDemoSnapshot('warning')).toMatchObject({ active: true, demo: true });
    expect(storms.peekStormSnapshot()).toBeNull();
  });
});
