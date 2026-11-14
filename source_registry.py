"""The online building source is OpenStreetMap; exact points are never accepted."""
from map_gateway import fetch_surroundings, tile_bounds

SOURCES = {'osm': {'label': 'OpenStreetMap', 'coverage': 'worldwide where mapped'}}

def normalize_scene_request(body):
    if not isinstance(body, dict) or set(body) - {'row', 'col', 'source', 'trees'}:
        raise ValueError('Map requests accept only coarse area indices.')
    if body.get('source', 'osm') != 'osm':
        raise ValueError('Only OpenStreetMap is available. Refresh the page and retry.')
    if 'trees' in body and type(body['trees']) is not bool:
        raise ValueError('Invalid map request.')
    area = {field: body.get(field) for field in ('row', 'col')}
    tile_bounds(area)
    return area

def fetch_scene(body):
    result = fetch_surroundings(normalize_scene_request(body))
    result['meta']['source_id'] = 'osm'
    return result
