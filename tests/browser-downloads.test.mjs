import {readFile, readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {LAST_YEAR} from '../web/model.js';
import {mapTile} from '../web/maps.js';
import {browserMapArea, browserWeatherYear} from '../web/providers.js';

test('the browser fetches the coarse map area with an Overpass fallback', async t => {
  const tile = mapTile(52.52255, 13.38525);
  const element = {type: 'node', id: 1, lat: 52.52, lon: 13.39, tags: {natural: 'tree'}};
  const requests = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'origin');
    const query = url.searchParams.get('data');
    assert.ok(query.includes(`(${tile.bounds.join(',')})`));
    assert.ok(!query.includes('52.52255'));
    if (url.hostname === 'overpass.private.coffee') return new Response('{}', {status: 503});
    assert.equal(url.hostname, 'overpass-api.de');
    return Response.json({elements: [element]});
  });
  const data = await browserMapArea(tile);
  assert.deepEqual(data.elements, [element]);
  assert.deepEqual(data.meta.coarse_tile, {row: tile.row, col: tile.col});
  assert.equal(data.meta.cached, false);
  assert.equal((await browserMapArea(tile)).meta.cached, true);
  assert.equal(requests.mock.callCount(), 2);
});

test('the portable map fallback merges all four coarse quadrants', async t => {
  const site = {lat: 48.14239, lon: 11.57327};
  const tile = mapTile(site.lat, site.lon);
  const [south, west, north, east] = tile.bounds;
  const midLat = (south + north) / 2, midLon = (west + east) / 2;
  const quadrants = [];
  const now = performance.now();
  t.mock.method(performance, 'now', () => now + 31_000);
  const node = {type: 'node', id: 1, lat: midLat, lon: midLon, tags: {natural: 'tree'}};
  const relation = {type: 'relation', id: 10, tags: {building: 'yes', type: 'multipolygon'}};
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.hostname !== 'api.openstreetmap.org') return new Response('{}', {status: 503});
    assert.equal(url.pathname, '/api/0.6/map.json');
    const bounds = url.searchParams.get('bbox');
    assert.ok(!bounds.includes(String(site.lat)) && !bounds.includes(String(site.lon)));
    quadrants.push(bounds.split(',').map(Number));
    const ref = quadrants.length + 20;
    return Response.json({elements: [node, {type: 'way', id: ref, nodes: [1, 1]},
      {...relation, members: [{type: 'way', ref, role: 'outer'}]}]});
  });
  const data = await browserMapArea(tile, {useReadApiFallback: true});
  assert.deepEqual(quadrants, [[west, south, midLon, midLat], [midLon, south, east, midLat],
    [west, midLat, midLon, north], [midLon, midLat, east, north]]);
  assert.equal(data.elements.length, 2);
  assert.deepEqual(data.elements.find(e => e.id === 10).members.map(member => member.ref), [21, 22, 23, 24]);
  assert.deepEqual(data.elements[1].members[0].geometry, Array(2).fill({lat: midLat, lon: midLon}));
  assert.equal((await browserMapArea(tile, {useReadApiFallback: true})).meta.cached, true);
  assert.equal(quadrants.length, 4);
});

test('the browser sends rounded weather coordinates and requires every padded hour', async t => {
  const year = LAST_YEAR;
  const start = Date.UTC(year - 1, 11, 31) / 1000;
  const hours = (Date.UTC(year + 1, 0, 2) / 1000 - start) / 3600;
  const times = Array.from({length: hours}, (_, index) => start + 3600 * index);
  const location = {lat: 52.52255, lon: 13.38525, grid: .1};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://archive-api.open-meteo.com');
    assert.equal(options.credentials, 'omit');
    const query = url.searchParams;
    assert.equal(query.get('latitude'), '52.5');
    assert.equal(query.get('longitude'), '13.4');
    assert.equal(query.get('start_date'), `${year - 1}-12-31`);
    assert.equal(query.get('end_date'), `${year + 1}-01-01`);
    const hourly = Object.fromEntries(query.get('hourly').split(',').map(field => [field, times.map(() => 1)]));
    return Response.json({hourly: {time: times, ...hourly}});
  });
  const data = await browserWeatherYear(location, year);
  assert.equal(data.meta.year, year);
  assert.deepEqual(data.hourly.time, times);
  times.pop();
  await assert.rejects(browserWeatherYear(location, year), /incomplete weather year/);
});

test('the sharing service worker saves all app files and serves them from cache', async () => {
  const origin = 'https://demo.trycloudflare.com';
  const root = new URL('../web/', import.meta.url);
  const html = await readFile(new URL('index.html', root), 'utf8');
  const appUrl = html.match(/src="(\/app\.js\?[^"\s]+)"/)[1];
  const build = new URL(appUrl, origin).search;
  const files = await readdir(root, {recursive: true});
  const assets = ['/'];
  for (const file of files.filter(name => /\.(css|js)$/.test(name))) {
    if (file !== 'offline.js') assets.push(file === 'app.js' ? appUrl : `/${file}`);
  }
  const events = {};
  const saved = new Set();
  const serviceWorker = {
    location: new URL(`/offline.js${build}`, origin),
    addEventListener: (name, listener) => { events[name] = listener; },
    skipWaiting: async () => {},
  };
  const cache = {
    addAll: async paths => { paths.forEach(path => saved.add(path)); },
    match: async path => saved.has(path) ? path : undefined,
  };
  runInNewContext(await readFile(new URL('offline.js', root), 'utf8'), {
    self: serviceWorker, URL, caches: {open: async () => cache},
    fetch: () => assert.fail('this request must not use the network'),
  });
  let installed;
  events.install({waitUntil: result => { installed = result; }});
  await installed;
  assert.deepEqual(saved, new Set(assets));

  for (const asset of assets) {
    let response;
    events.fetch({request: {url: origin + asset, method: 'GET', mode: asset === '/' ? 'navigate' : 'cors'},
      respondWith: result => { response = result; }});
    assert.equal(await response, asset);
  }
  events.fetch({request: {url: 'https://archive-api.open-meteo.com/v1/archive', method: 'GET'},
    respondWith: () => assert.fail('the browser must send provider requests directly')});
});
