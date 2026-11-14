import {mapTileBounds} from './maps.js';
import {LAST_YEAR, roundedLocation} from './model.js';

const OVERPASS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const OSM_READ_API = 'https://api.openstreetmap.org/api/0.6/map.json';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const WEATHER_FIELDS = ['temperature_2m', 'wind_speed_10m', 'shortwave_radiation',
  'direct_normal_irradiance', 'diffuse_radiation'];
const mapCache = new Map();
let lastMapRequest = -Infinity;

async function providerJson(url, {signal, timeout, limit, referrerPolicy = 'no-referrer'}) {
  const deadline = AbortSignal.timeout(timeout);
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`Provider returned HTTP ${response.status}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw Error('Provider response exceeds the download limit.');
      text += decoder.decode(value, {stream: true});
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text + decoder.decode());
}

function addReadApiGeometry(elements, combined) {
  const nodes = new Map();
  const ways = new Map();
  for (const element of elements) {
    if (element.type === 'node') nodes.set(element.id, {lat: element.lat, lon: element.lon});
    if (element.type === 'way') ways.set(element.id, element);
  }
  function geometry(way) {
    const points = way?.nodes?.map(id => nodes.get(id));
    return points?.length && points.every(Boolean) ? points : null;
  }
  for (const {type, id, tags, lat, lon, members} of elements) {
    const key = `${type}/${id}`;
    if (type === 'node' && tags?.natural === 'tree') {
      combined.set(key, {type, id, tags, lat, lon});
    } else if (tags?.building && tags.building !== 'no') {
      if (type === 'way') {
        const points = geometry(ways.get(id));
        if (points) combined.set(key, {type, id, tags, geometry: points});
      } else if (type === 'relation' && tags.type === 'multipolygon') {
        const parts = new Map(combined.get(key)?.members.map(member => [member.ref, member]));
        for (const member of members ?? []) {
          if (member.type !== 'way') continue;
          const points = geometry(ways.get(member.ref));
          if (points) parts.set(member.ref, {...member, geometry: points});
        }
        combined.set(key, {type, id, tags, members: [...parts.values()]});
      }
    }
  }
}

async function readMapArea(bounds, signal, onProgress) {
  const [south, west, north, east] = bounds;
  const middleLat = (south + north) / 2, middleLon = (west + east) / 2;
  const combined = new Map();
  let part = 0;
  // Fetch all fixed quadrants, independent of the user's position inside the area.
  for (const [bottom, top] of [[south, middleLat], [middleLat, north]]) {
    for (const [left, right] of [[west, middleLon], [middleLon, east]]) {
      const url = new URL(OSM_READ_API);
      url.searchParams.set('bbox', [left, bottom, right, top].join(','));
      onProgress(`Downloading OpenStreetMap fallback · ${++part} / 4…`);
      const data = await providerJson(url, {signal, timeout: 25_000, limit: 32_000_000});
      if (!Array.isArray(data?.elements) || data.error || data.remark) throw Error('Incomplete map area.');
      addReadApiGeometry(data.elements, combined);
    }
  }
  return [...combined.values()];
}

export async function browserMapArea({row, col}, {signal, onProgress = () => {}, useReadApiFallback = false} = {}) {
  signal?.throwIfAborted();
  const bounds = mapTileBounds(row, col);
  const key = `${row}:${col}`;
  if (mapCache.has(key)) {
    const data = mapCache.get(key);
    return {...data, meta: {...data.meta, cached: true}};
  }
  if (performance.now() - lastMapRequest < 30_000) throw Error('Please wait 30 seconds between map downloads.');
  lastMapRequest = performance.now();
  const bbox = bounds.join(',');
  const query = `[out:json][timeout:20];(way["building"]["building"!="no"](${bbox});` +
    `relation["building"]["building"!="no"]["type"="multipolygon"](${bbox});node["natural"="tree"](${bbox}););out tags geom;`;
  let elements, endpoint;
  for (const provider of OVERPASS) {
    onProgress(`Downloading map data from ${new URL(provider).hostname}…`);
    try {
      const url = new URL(provider);
      url.searchParams.set('data', query);
      const result = await providerJson(url, {signal, timeout: 25_000, limit: 8_000_000, referrerPolicy: 'origin'});
      if (!Array.isArray(result?.elements) || result.remark || result.error) continue;
      elements = result.elements;
      endpoint = provider;
      break;
    } catch {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    }
  }
  if (!elements && useReadApiFallback) {
    try {
      elements = await readMapArea(bounds, signal, onProgress);
      endpoint = OSM_READ_API;
    } catch {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    }
  }
  if (!elements) throw Error('The map providers could not return this area. Try again later or import GeoJSON.');
  const data = {
    elements,
    meta: {
      source: 'OpenStreetMap contributors', source_id: 'osm', provider: endpoint, bounds,
      downloaded_at: new Date().toISOString(), cached: false, coarse_tile: {row, col},
      licence: 'ODbL 1.0', attribution_url: 'https://www.openstreetmap.org/copyright',
    },
  };
  if (mapCache.size === 3) mapCache.delete(mapCache.keys().next().value);
  mapCache.set(key, data);
  return data;
}

export async function browserWeatherYear(location, year, {signal, onProgress = () => {}} = {}) {
  if (!Number.isInteger(year) || year < LAST_YEAR - 9 || year > LAST_YEAR) {
    throw Error(`Choose a complete calendar year between ${LAST_YEAR - 9} and ${LAST_YEAR}.`);
  }
  const {lat, lon, grid} = roundedLocation(location);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw Error('Choose valid weather coordinates.');
  const url = new URL(ARCHIVE);
  url.search = new URLSearchParams({
    latitude: lat, longitude: lon, start_date: `${year - 1}-12-31`, end_date: `${year + 1}-01-01`,
    hourly: WEATHER_FIELDS.join(','), models: 'era5', timezone: 'UTC', timeformat: 'unixtime',
    wind_speed_unit: 'ms', elevation: 'nan',
  });
  onProgress('Downloading historical weather from Open-Meteo…');
  let data;
  try {
    data = await providerJson(url, {signal, timeout: 75_000, limit: 12_000_000});
  } catch {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw Error('Open-Meteo could not return this weather year. Try again later or import saved weather.');
  }
  const times = data?.hourly?.time;
  const start = Date.UTC(year - 1, 11, 31) / 1000;
  const hours = (Date.UTC(year + 1, 0, 2) / 1000 - start) / 3600;
  const valid = Array.isArray(times) && times.length === hours &&
    times.every((time, index) => time === start + index * 3600) && WEATHER_FIELDS.every(field => {
      const values = data.hourly[field];
      return Array.isArray(values) && values.length === hours && values.every(Number.isFinite);
    });
  if (!valid) throw Error('Open-Meteo returned an incomplete weather year. Try again later or import saved weather.');
  return {
    ...data,
    meta: {
      year, requested_latitude: lat, requested_longitude: lon, grid,
      provider: 'Open-Meteo / Copernicus ERA5', model: 'era5',
      downloaded_at: new Date().toISOString(), cached: false,
      radiation_interval: 'preceding-hour mean; evaluated at midpoint',
      source_url: 'https://open-meteo.com/en/docs/historical-weather-api',
    },
  };
}
