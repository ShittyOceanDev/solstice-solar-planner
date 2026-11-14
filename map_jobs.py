"""Short local HTTP requests around potentially slow public map downloads."""
from map_gateway import fetch_surroundings, tile_bounds
from download_jobs import DownloadJobs

class MapJobs(DownloadJobs):
    def __init__(self, fetch=fetch_surroundings, normalize=None):
        def normalize_area(area):
            tile_bounds(area)
            return dict(area)
        super().__init__(fetch,normalize or normalize_area,'map area',
                         'The building data provider is unavailable. Retry later or use a local geometry file. Your current scene is unchanged.')
