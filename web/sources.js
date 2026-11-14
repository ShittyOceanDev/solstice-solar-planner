// Retired source metadata is retained only to attribute existing saved geometry.
export const SOURCES={
  osm:{label:'OpenStreetMap',provider:'OpenStreetMap',attribution:'© OpenStreetMap contributors',licence:'ODbL 1.0',url:'https://www.openstreetmap.org/copyright'},
  'de-bb-lod2':{label:'Imported building model',provider:'Official3D',attribution:'© GeoBasis-DE/LGB, dl-de/by-2-0 (data transformed)',licence:'dl-de/by-2-0',url:'https://geobasis-bb.de/lgb/de/geodaten/3d-produkte/3d-gebaeudemodelle/'}
};
export const sourceInfo=value=>SOURCES[value?.sourceId||value?.source_id]||SOURCES.osm;
