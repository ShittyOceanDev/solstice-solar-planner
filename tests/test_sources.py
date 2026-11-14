import unittest
from unittest.mock import patch
import source_registry as sources

class SourceTests(unittest.TestCase):
    def test_only_osm_is_registered_and_old_osm_requests_normalize(self):
        self.assertEqual(set(sources.SOURCES), {'osm'})
        area = {'row': 7126, 'col': 5882}
        self.assertEqual(sources.normalize_scene_request({**area, 'source': 'osm', 'trees': False}), area)
        with patch.object(sources, 'fetch_surroundings', return_value={'elements': [], 'meta': {}}) as fetch:
            self.assertEqual(sources.fetch_scene(area)['meta']['source_id'], 'osm')
            fetch.assert_called_once_with(area)

    def test_removed_sources_and_precise_fields_are_rejected(self):
        for extra in ({'source': 'auto'}, {'source': 'de-bb-lod2'}, {'lat': 52.5}, {'url': 'https://example.com'}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                sources.normalize_scene_request({'row': 7126, 'col': 5882, **extra})
