# Validation

Verified on 29–30 October 2026 with Node.js 24.21.0, Python 3.14.4, and a browser.

## Automated checks

`npm test` passes: 81 cases in total. JavaScript files report 14 numerical/model cases, 3 panel preset cases, 9 map/geometry cases, 3 retained-mesh cases, 8 response/polling cases and 3 setup data cases; the Python suite reports 41 gateway/privacy/job/transport/cache/source/hosting cases. The Node runner may summarize the JavaScript suites as six passing files. Removed official-source parser tests no longer describe an available download feature; mesh compatibility remains covered.

Covered: equinox/solstice/night solar geometry, named time zones and DST, fractional UTC offsets, coarse-location enforcement, rotated building intersections, tree transmission and southern seasons, inverter clipping, nighttime output, thermal derating, annual/monthly load conservation, baseline demand, analytic payback, replacement cost, degradation and self-use, generation conservation, leap-year/local-year completeness, rejection of incomplete weather, historical-mode source integrity, and annual shading reduction. Gateway tests verify that upstream requests receive rounded coordinates, invalid privacy grids are rejected, and cached years avoid network access.

## Live historical weather

Downloaded Open-Meteo / Copernicus ERA5 hourly data for the **example Berlin region**, rounded to 52.5° N, 13.4° E. These are example coordinates, not an inferred user location. All five complete local calendar years were accepted:

| Year | Hourly intervals | Modelled AC generation |
| --- | ---: | ---: |
| 2021 | 8,760 | 796.205 kWh |
| 2022 | 8,760 | 898.075 kWh |
| 2023 | 8,760 | 826.962 kWh |
| 2024 | 8,784 | 863.442 kWh |
| 2025 | 8,760 | 908.124 kWh |

For the default example scene (two 440 W panels, 800 W inverter, 65° tilt, south facing, floor 2, surrounding example objects), the five-year average is **858.562 kWh/year** and nominal payback is approximately **4.56 years**, using the example costs and consumption. These are model outputs, not a measured or independently calibrated benchmark.

## Browser checks

- 3D scene renders; panels, building and tree geometry, sun path, shadows, orbit, zoom and view controls are present. No browser errors or warnings were recorded in the completed session.
- Added, edited and removed a building. Height changes update daily shading and annual output.
- Edited baseline household demand; consumption information updates, and focus remains in the next input.
- Selected 21 June 2025 in historical mode: daily reconstruction differs from the five-year calendar-day average and is labelled accordingly.
- Loaded five weather years; browser reload restores them from the local cache without an external request.
- Exported last year's hourly CSV and checked **8,760 rows**, totalling **908.124 kWh**. Interval midpoints run from 2024-12-31 23:30 UTC through 2025-12-31 22:30 UTC, corresponding to the 2025 Europe/Berlin local year. Rounded CSV self-use + export conserves generation to within 0.000001 kWh per row.
- Imported the local sample GeoJSON fixture: one building and one tree became editable relative geometry with the expected heights. Map origins disappeared when the inspector was rebuilt. Removed imported test objects afterward.
- Downloaded a project file and verified that it contains settings and relative objects, without the GeoJSON's geographic footprint coordinates or exact origin fields.
- Saved a full-page preview to `docs/solstice-preview.jpg`.

## Panel preset update

Added six sourced module presets spanning PERC, TOPCon, HPBC back contact and HJT. Browser checks confirmed that selecting REC Alpha Pure-RX loads 460 W, 1.205 × 1.728 m and −0.24%/°C, changes generation, and keeps the installation and inverter settings intact. Editing the rated power changes the selector to Custom. The new automated cases verify preservation of installation settings, old project compatibility, label invalidation after specification changes, and propagation into panel geometry and generation. Datasheet references are stored locally in `web/panels.js`. The viewport labels its scene source.

## Automatic surroundings update

- Downloaded a broad public Berlin map area (tile row 7126, column 5882) and retained 14,995 building/tree elements. Overpass providers timed out; the official OpenStreetMap read-API fallback completed. All four fixed quadrants of the same coarse area were requested, independent of the selected local point. The map cache contains no exact selection or installation point.
- The Berlin public example generated an editable scene with 76 buildings and 27 mapped trees. The preview labelled missing heights as assumptions or estimates from mapped floor counts.
- Confirmed the generated scene survives browser reload. With the loaded 2021–2025 regional weather and example settings, the dashboard reports approximately 750 kWh/year, 5.4 years nominal payback, and 788 kWh for the 2025 reconstruction. These remain model outputs, not calibrated measurements.
- In the browser, changed the first generated building from 18 m to 21 m. Its source note changed to user-edited; annual generation changed to approximately 735 kWh and payback to 5.5 years. Restored the height to 18 m afterward.
- Map tests cover coarse requests, local map-link parsing, height units, generated footprint editing, multipolygon assembly, concave shapes and courtyards, rotated facade placement and mounting on a solid roof patch. Python tests cover strict map request fields, provider normalization/fallback and cache behaviour.
- Reduced decorative meshes on surrounding buildings and render only when the scene/camera changes. A generated-neighbourhood screenshot rendered during development. The final screenshot capture was unavailable in the current browser session; the latest camera framing has not had a final visual review.

## Map response handling and onboarding

- Confirmed that the public Berlin map response is valid through the running gateway, and reproduced the browser workflow using a cached area.
- Replaced the browser's direct JSON parsing with checked response handling. Empty/truncated responses, non-JSON errors and obsolete backends have readable messages. Provider-side empty/malformed responses now try the next provider rather than exposing a parser error.
- Added local background map jobs and short status requests. Tests verify that a slow download returns a job immediately, reconnects to the same active area, retries an empty status response without repeating the download, cancels browser polling, and rejects precise-coordinate job fields.
- On a separate local origin (port 8767), confirmed first-visit onboarding opens automatically and blocks continuation without a usable location. Generated the public example's 76-building / 27-tree scene from inside setup.
- Selected REC Alpha Pure-RX 460 W, set annual consumption to 3,600 kWh, buying costs to €1,200 and the import tariff to €0.40/kWh. The review showed these values and €1,400 capital including installation. An invalid 800 kWh annual target against a 120 W baseline was rejected. Completing setup saved the values and explicitly selected five-year weather loading restored 2021–2025 data.
- Reopened setup, changed panel power to 500 W and cancelled; the planner retained 460 W. Browser reload restored the completed project without reopening onboarding.
- Exported that test project: weather coordinates are 52.5°, 13.4°; the exact public input strings are absent, relative map geometry is retained, monthly consumption sums to 3,600 kWh, and the selected panel/tariff are preserved. Relative map geometry and public IDs can still identify a building, as documented.
- Verified the cached map workflow after a local server restart. Both browser sessions reported zero console warnings or errors.

## Shared map/weather transport update

- Changed local API replies to uncompressed JSON with explicit Content-Length and Cache-Control: no-store. Added a native XMLHttpRequest fallback for a Fetch response whose body is empty. Regression tests simulate that missing-body failure and confirm the same local request fields are retained.
- Weather now uses background jobs and short progress requests, like map loading. Job normalization retains only rounded weather coordinates, privacy grid and year.
- Confirmed that the local API sent complete plain JSON even when the client accepted gzip.

## Official sources and correlated diagnostics (earlier development; loader subsequently removed)

- Removed the proprietary map-link parser and UI references. Coordinates and OpenStreetMap coordinate links are accepted locally; unrelated map-service URLs are rejected.
- Implemented the official Brandenburg adapter using the published downloadable CityGML ZIP tiles, with GeoBasis-DE/LGB attribution and dl-de/by-2-0. WFS capabilities were reachable, but both area queries and a minimal one-building GetFeature request timed out after 30–60 seconds. The static model-file download route worked.
- Triangulated actual roof/wall surfaces are shared by the renderer and ray model. Regression tests verify clear sky above low eaves, shaded points below the ridge, mesh transforms and provenance. UTM conversions are checked in their normal zones, including AdV zone-prefixed eastings. CityGML parsing is bounded, rejects external entities and omits models without roof/ground surfaces.
- Large job results now use bounded 64 KiB text segments, byte-length verification and SHA-256 where Web Crypto is available. Tested reconstruction, metadata privacy and server-side segmentation. The native HTTP fallback parses response text directly.
- Added correlated, local-only connection traces: protocol/instance identity, request stage/reference, HTTP status, expected/written/received byte counts. Empty browser replies report metadata back to the loopback server. Coordinates, source area indices, bodies and scenes are excluded. Tests distinguish a body lost after a recorded server write from an unmatched request, and verify snapshots are detached.
- Browser checks confirmed that GET and POST probes, including 64 KB and 512 KB responses, returned the expected byte counts. The intermittent empty HTTP 200 response remains unexplained.

## Public hosting preparation, 30 October 2026

- Removed the regional official-data loader, CityGML/UTM parser modules, automatic source mode and source/tree-overlay controls. New map lookups only use OSM. Retained legacy attribution metadata and mesh handling so previously saved projects remain editable and correctly attributed. No new LGB network path remains.
- Added a production WSGI application and pinned Gunicorn 26.2.0, one gthread worker with eight threads, non-root Docker configuration, native-Python startup configuration, explicit HTTPS-origin validation, security headers, fixed upstream endpoints, bounded JSON requests and provider replies, and bounded rate-limit state. Local `server.py` remains loopback-only and package-free.
- New regression checks exercise foreign-origin/host rejection (including spoofed forwarding headers), TLS termination behavior, request/body limits, hidden/traversal paths, static HEAD/content lengths, the actual CSP import-map hash, job polling/segments, rate-limit recovery, disabled shared diagnostics/uploads, cache decompression limits/expiry/pruning and disposable-cache write errors. Completed jobs now expire during reads, without needing another job start.
- Initial cold production map test failed at the 4 MB raw OSM quadrant limit. Changed the official OSM read-API fallback to resolve and compact each fixed quadrant separately, retaining only building/tree geometry and merging relation members. Hosted raw quadrant limit is now 16 MB; compact transfer limit remains 20 MB. Added a regression test for relation assembly across four separately compacted extracts.
- Started Gunicorn on loopback with a test HTTPS origin and simulated the hosting edge's Host and Origin headers. The smoke checker reconstructed a map lookup from transfer parts and verified byte counts and SHA-256.
- The same production smoke check downloaded 2025 Berlin-region ERA5 data: 8,808 provider hours including calendar padding. Static assets, runtime deployment identity, GET/POST probes, other-origin rejection and browser-only diagnostics passed. This is a connectivity/transfer check, not a site prediction or a comparison with measured generation.
- Verified the OSM workflow in the browser. The public Berlin preview displayed 76 buildings and 27 trees and enabled generation confirmation. No console errors or warnings were reported.
- Added an allowlisted release packager, deployment instructions and a deployment smoke checker. Docker is not installed in this environment, so an actual image build was not run. No real hosting account/deployment or managed TLS endpoint has been tested; provider memory/egress limits still require verification after deployment. Northflank/Alwaysdata/Render/Koyeb/Cloudflare comparisons were researched from their current primary documentation, linked in DEPLOYMENT.md.
- Extracted the release archive into a temporary directory and checked that its WSGI entry point served the health endpoint, runtime configuration and browser assets. Missing HTTPS-origin configuration prevented startup.
- Updated public/local privacy wording. Hosted diagnostics stay in the browser; no shared request traces are exposed. The host receives page requests, IP and coarse map/weather requests. Projects, costs, consumption, exact point and chosen building stay browser-side. Local caches and user data are excluded from the upload package.

## Limits

No comparison with a calibrated site survey, inverter meter, commercial shading simulator or measured energy-use trace was performed. Passing tests establishes computational consistency, not real-world accuracy. Historical weather remains a regional reconstruction. The model's approximations and omitted effects are documented in README.md and the in-app model explanation.
