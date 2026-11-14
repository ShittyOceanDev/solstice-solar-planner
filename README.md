# Solstice solar planner

A solar generation and payback planner with an editable 3D scene. Project settings and calculations stay in the browser. The local version needs no account, map API key or Python packages. A separate production entry point supports a small public deployment; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Run the portable file

Download `solstice-portable.html` from [GitHub Releases](https://github.com/ShittyOceanDev/solstice-solar-planner/releases/latest).

Double-click `solstice-portable.html`, or open it from a modern browser on Windows or Linux. The HTML file contains the calculator and 3D assets. It needs no installer, Python, or local server. The 3D view requires WebGL 2.

**Load historical weather** and **Generate from location** download data directly from Open-Meteo and the OpenStreetMap providers. They require internet access. Example weather, calculations, and local project, weather, and GeoJSON imports also work without a connection.

Use **Save project** to move your settings and scene between computers or browsers. Use **Export loaded weather** to carry the hourly data too. Browser autosave and cached weather may depend on the browser profile and where you opened the HTML file.

To rebuild `dist/solstice-portable.html` from the full source checkout, run `npm ci` and `npm run build:portable`. Only the generated HTML file is needed to use the app.

## Run the local server

Requires uv and a modern browser with WebGL for the 3D view. The project selects Python 3.13.16 and keeps its Python environment in `.venv`, with dependencies locked in `uv.lock`.

```bash
uv sync --locked
./start.sh
```

Alternatively, run `uv run --locked python server.py`. The server itself uses only the standard library, so `python3 server.py` also works without third-party packages. Open **http://127.0.0.1:8766** in your browser. Keep the terminal running; Ctrl+C stops the app. To use another port, run `./start.sh --port 8770`. The exact Gunicorn pin in `requirements.txt` is retained for hosted/container deployment.

The Three.js runtime and its MIT licence are included in `web/vendor/`. The program works offline with illustrative weather, previously downloaded weather, and saved scenes. Internet access is needed when you explicitly load new weather or a new map area.

## Use it

On a first visit, a five-step setup opens automatically: **Location → Panels → Energy use → Pricing → Review**. Enter coordinates or choose a weather region, optionally generate and confirm your surroundings, choose the panel and installation, and enter your consumption, electricity tariff and purchase/installation costs. Setup checks that annual consumption covers the always-on baseline. The review offers an explicit option to load historical weather after finishing; no external download starts merely by opening setup. You can also explore the example or continue later.

Setup works on a separate draft. **Create my outlook** saves it; closing or cancelling leaves the current project unchanged. New personal setups start without the example neighbouring buildings. Changing location without generating a replacement scene removes the old location's surroundings on completion, with a warning in the review. The header's **Setup** button reopens the workflow at any time. Returning visitors keep their saved project.

1. **Site & panels:** choose a region or enter coordinates, which are immediately rounded to your selected privacy grid. Set panel count and rated power, AC inverter limit, façade or roof, floor, height, tilt, and direction. Under the expandable controls, configure the building dimensions, panel dimensions, losses, ventilation and electrical arrangement. Azimuth is clockwise from true north: 0° north, 90° east, 180° south, 270° west. Tilt is measured from horizontal.
2. **Surroundings:** use **Generate from location** to automatically build a local scene, then edit the result or add missing objects. All positions are relative metres: positive x = east, positive z = south. Buildings have editable footprints, width, depth, height, base and rotation. Trees have canopy dimensions, seasonal foliage and light transmission. Click a 3D object to select it; drag to orbit or scroll to zoom. The compass follows the camera. Top view helps with positioning.
3. **Energy use:** set total annual consumption, always-on watts, a daily usage profile and monthly kWh. The baseline is included in the annual total. When the entered monthly sum equals the annual target, and each month can accommodate the baseline, those monthly totals are preserved. Otherwise, the model redistributes the flexible portion while respecting the annual total and baseline. The annual target is raised if the baseline alone exceeds it. Monthly totals account for local daylight-saving changes.
4. **Costs & payback:** enter hardware, installation, subsidy, import and export electricity prices, maintenance, price growth, degradation, lifetime, discount rate and optional inverter replacement. Currency changes the label, without converting amounts. All prices are your assumptions, not live market prices.
5. **Weather & model:** explicitly download one, five or ten complete years of hourly weather. ERA5 provides a consistent regional climate sample. The dashboard averages independent yearly simulations; last year's reconstruction remains visible separately. Change the region and explicitly load that region's weather.
6. **Explore a day:** choose a date and local time. Average mode averages that calendar day across the loaded years. Historical mode requires a date in a loaded historical year. The sun position and 3D shadows follow the selected date and time. These are weather estimates, not forecasts.

### Panel presets

**Site & panels → Panel type / model** includes six representative residential modules: Trina Vertex S+ 450 W, Jinko Tiger Neo 440 W, JA Solar DeepBlue 3.0 400 W, LONGi Hi-MO X6 440 W, REC Alpha Pure-RX 460 W and Canadian Solar TOPHiKu6 450 W. These cover PERC, TOPCon, HPBC back contact and HJT technologies; the list is not a market-share ranking. Manufacturer datasheets are linked beside each selection, with the source catalogue in `web/panels.js`.

Choosing a preset fills its STC rated power, physical width/length and Pmax temperature coefficient. Panel count, installation, inverter limit, losses, degradation and costs retain your entered settings. Editing a preset's power, dimensions or temperature coefficient changes the selection to **Custom** so that modified values cannot be mistaken for manufacturer specifications. Existing projects keep their previous values. Re-select a named preset to restore its specifications. Source specifications were checked on 29 October 2026; verify the exact revision and power class of the module you intend to install. No rear-side bifacial bonus is assumed.

### Generate surroundings from a location

Click **Generate from location** in Site & panels, Surroundings, or below the 3D view. Enter latitude/longitude or an OpenStreetMap coordinate link. Links are parsed locally; no external map page is opened. Check the site's time zone and choose a neighbourhood radius of 100, 150 or 200 m. The prefilled point is the approximate weather point; replace it with your actual building point locally.

OpenStreetMap is the online building source, worldwide where mapped. It provides footprints, available heights/floor counts and individual mapped trees. Missing heights and foliage need checking in the editor. The regional official-data loader and source selector have been removed. Previously saved model geometry remains editable with its original attribution.

Before downloading, the dialog shows the broader requested area and names the possible providers. Confirm your installation building in the local preview, then click **Generate editable 3D scene**. The selected building becomes your main building, other nearby models and trees become editable obstructions, and the weather point is independently rounded to your weather privacy grid. Changing the weather region later does not silently download another scene; the app flags that regeneration is needed. The nearest footprint is only a suggestion when the point is outside a building: confirm the correct building before applying.

Map downloads run as background jobs on the local or hosted server. The browser checks progress through short requests and can reconnect to the same active lookup after an interrupted response. Empty, truncated or non-JSON responses show readable retry instructions; unsuccessful lookups preserve the current scene. An outdated running server is detected and prompts a restart. After updating the program, stop its old terminal process with Ctrl+C and run `./start.sh` again, then refresh the browser.

Weather downloads also use background jobs, one complete year at a time. The server normalizes weather coordinates before retaining a job, and reconnecting to an active request reuses it. API replies use plain JSON and disable HTTP caching; downloaded files on disk remain compressed. If an embedded browser returns a Fetch response with a missing body, the loader retries the same server request through native XMLHttpRequest. This fallback never sends a request directly to a map or weather provider.

OSM footprints retain their polygon shape and courtyards in both the 3D renderer and ray calculations. Buildings are extruded footprints; the default 9 m height is explicitly marked when data is absent, and floor counts imply an estimated 3 m per floor. Editing dimensions and orientation changes the geometry used by the view and shading calculation. No terrain surface is imported.

At most 120 surrounding objects are used, with omissions reported. Use horizontal façade offset for irregular buildings and check floor spacing separately from total height. Recorded heights can still be outdated; verify recent construction and foliage.

Generation saves one previous scene in this browser. **Undo last map generation** restores the previous building/scene/location while retaining current costs, consumption and panel specifications. A public Berlin example lets you try the workflow without a personal location. The offline GeoJSON import remains available for other geometry sources. The generated OSM view is an editable model rather than textured photogrammetry.

### Connection diagnostics

**Generate from location** and **Weather & model** contain **Connection diagnostics**. Run the connection checks to test server identity, GET/POST replies and small/large response bodies. Error messages identify the failing stage (`map-start`, `map-poll`, `map-part`, or weather equivalents) and a request reference. In local mode, the server and browser correlate expected/written/received byte counts and protocol identity. Public deployments keep observations in the visitor’s browser and do not disclose shared server traces. This distinguishes a provider failure, an empty reply observed after a server write, and a reply not seen by this server. A successful check does not prove an intermittent error is resolved.

Large completed map/weather results are delivered in bounded segments, reconstructed locally and checked for byte length and SHA-256 integrity where Web Crypto is available. Incomplete results never replace the current scene or weather. The native HTTP fallback parses its received text directly. **Save diagnostic report** downloads connection metadata for review. Connection observations are held in browser memory, and exclude request bodies, exact/coarse coordinates, area indices, geometry, usage and costs. The report includes browser/version information and the site origin. Hosted mode never automatically uploads it; local mode can report metadata-only empty-response evidence to its own loopback server.

Use **Save project** to download your settings and relative scene, and **Open project** to restore them. The app also saves settings in the browser automatically. **Export CSV** exports the monthly outlook and financial projection. The weather panel exports last year's complete hourly modelled generation and can export/import weather for offline use.

## Privacy

- Local mode (`server.py`) binds only to `127.0.0.1`. Hosted mode uses the production WSGI entry point, an explicit HTTPS site origin and managed HTTPS termination. The hosting provider receives the visitor’s IP, page requests, coarse map area indices and rounded weather requests, and may keep its own access logs.
- Does not request GPS, an address, remote map tiles, fonts, analytics, or trackers.
- Rounds coordinates in both browser and server before weather requests. Minimum grid: 0.1° (about 11 km north–south; east–west size varies with latitude). This is a grid width, not an anonymity radius.
- Open-Meteo receives only coarse coordinates and weather parameters, and sees the connection's IP. Rounding reduces specificity; it does not guarantee anonymity. Read [Open-Meteo's privacy terms](https://open-meteo.com/en/terms).
- Building geometry, tree geometry, exact GeoJSON origin, usage and costs are never sent to the weather provider. The gateway does not log request URLs or bodies.
- Map generation uses a separate coarse area grid: approximately 2.2 km cells with boundary padding, normally a 2.9 × 2.9 km request. The browser sends only area row/column indices; the server rejects map requests containing exact-coordinate fields. The exact point, selected building and panel settings are not forwarded. Map providers see the larger area and the server connection’s IP (your connection in local mode); this reduces specificity, not anonymity.
- Map providers are Private.coffee's Overpass service, overpass-api.de, and an infrequent official OpenStreetMap read-API fallback. Calls are sequential, cached for seven days and limited to one new area lookup per 30 seconds. Public providers can be busy or unavailable; errors preserve your existing scene. For sustained/commercial workloads, use a suitable extract or service rather than relying on free public endpoints.
- Settings and the previous-scene undo copy live in this browser's `localStorage`; weather lives in IndexedDB and `.weather-cache/` on disk. Public downloaded map areas live in `.map-cache/`, without the exact selected point. Use browser site settings to remove local storage; remove either cache directory when the app is stopped to clear its server cache.
- Exact OpenStreetMap links/coordinates exist only in the local dialog and are cleared after use. Exported projects retain relative footprints/meshes and public source object IDs; their distinctive geometry/source IDs can identify a building. Project and CSV exports include coarse regional metadata. Weather exports contain coarse coordinates and downloaded weather. Share these files intentionally.

## Optional map data

Under **Surroundings → Import local map geometry**, import a GeoJSON FeatureCollection containing building polygons, multipolygons, or tree points (`natural=tree` / `type=tree`). Enter the installation origin in the two local fields. These exact coordinates are used only in memory to convert geographic coordinates to relative metres and are discarded when the inspector closes; they are never saved or sent anywhere.

Building polygons and courtyard holes are retained; their editable axes use an oriented bounding rectangle. Very detailed rings are sampled to bound computation. Supported properties include `name`, `height`, `building:levels`, `min_height`, `diameter_crown`, and `leaf_type`. Heights default to 9 m for buildings and 8 m for trees. Import is limited to 120 total objects and a 200 m radius; inspect and correct the result. No provider is contacted by an offline import. Use an appropriately licensed GeoJSON source.

## Physical model

- NOAA fractional-year solar position equations.
- Open-Meteo / Copernicus ERA5 hourly GHI, DNI, DHI, air temperature and wind. Radiation means cover the preceding hour; sun geometry is evaluated at that interval's midpoint. The gateway downloads endpoint padding to integrate complete **local** calendar years, including leap years and DST. Missing radiation values and incomplete years fail explicitly.
- Hay–Davies plane-of-array transposition, circumsolar diffuse, ground reflection and an ASHRAE-style beam incidence modifier (`b0=0.05`).
- Nine direct rays per module against manual building boxes, extruded footprints (including courtyards and bases), triangulated roof/wall meshes in previously saved projects, and ellipsoidal tree crowns. Mesh rays use a bounding-volume hierarchy. Roof placement samples the model's surface height. Seasonal foliage transmission compounds for overlapping trees. A 384-direction projected hemisphere integration estimates visible diffuse sky and ground from each module centre.
- Faiman panel temperature with open-mount `U0=26.9, U1=6.2` or roof-mount `20, 3.2`. Wind at 10 m is multiplied by an assumed 0.7 for panel-level exposure. User temperature coefficient, an approximate logarithmic low-light adjustment, combined system losses, optional seasonal snow assumption, inverter efficiency, AC clipping and annual degradation.
- Independent module MPPT or a conservative series approximation based on the most shaded module. This is not an individual cell or bypass-diode circuit solver. Diffuse and ground-reflected light are reduced by scene occlusion.
- Hourly energy matching: self-use = min(generation, household demand); the remainder is exported. No battery. Financial degradation recalculates matching rather than scaling the original self-use proportion.
- Nominal payback is the first cumulative cash-flow crossing, interpolated within the crossing year. End-of-year discounted cash flow gives NPV. Annual import/export rates grow at the selected price-growth rate. Maintenance and replacement costs remain fixed in nominal currency. The sensitivity band reruns generation at your selected ±percentage; it is not a statistical confidence interval.

**Historical generation is a reconstruction, not a precise measurement.** It describes what the configured system might have produced under regional historical weather. Exact last-year output requires actual generation readings. ERA5's roughly 25 km weather grid, location rounding, simplified geometry, foliage, within-hour shadows, panel technology, snow and usage assumptions create uncertainty. Terrain and distant horizon obstructions must be represented manually. 3D shadows illustrate geometry and do not render porous foliage or electrical behaviour exactly. No forecast, terrain survey, financing, dynamic tariff, tax or battery model is included.

## Sources and licences

- [Open-Meteo historical weather documentation](https://open-meteo.com/en/docs/historical-weather-api). Attribution: Open-Meteo and Copernicus Climate Change Service / ECMWF. Weather data CC BY 4.0. The free service permits non-commercial use; use a suitable provider plan for commercial use.
- [OpenStreetMap attribution and ODbL licence](https://www.openstreetmap.org/copyright). Map-derived project exports include attribution. [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), [official read API](https://wiki.openstreetmap.org/wiki/API_v0.6), and [building floor-count conventions](https://wiki.openstreetmap.org/wiki/Key:building:levels). Height estimates are assumptions, not surveyed data.
- [NOAA solar position equations](https://www.gml.noaa.gov/grad/solcalc/solareqns.PDF).
- [Sandia / IEA PVPS: PV Performance Modeling Methods and Practices](https://pvpmc.sandia.gov/app/uploads/sites/243/2022/10/Report-IEA-PVPS-T13-06-2017_PV_Performance_Modeling_Methods_and_Practices_SAND2017-2570-R.pdf).
- [JRC PV modelling methods](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/data-sources-calculation-methods_en). Solstice is independent software, not PVGIS, and does not reproduce the full PVGIS model.
- Three.js 0.180.0, MIT; licence included locally. `package-lock.json` pins the optional npm dependency used to obtain the bundled files. npm is not needed to run the app.

## Hosting

To share a temporary link and password with friends, see [Temporary sharing](DEPLOYMENT.md#temporary-sharing).

Use the included Dockerfile or `gunicorn --config gunicorn.conf.py wsgi:application`. Public hosting requires the HTTPS origin in `SOLSTICE_PUBLIC_ORIGIN`; it deliberately fails closed without it. The local development server remains local-only. [Deployment instructions and free-host comparison](DEPLOYMENT.md) cover the current options, limits, privacy behavior, and sanitized release package.

## Check the code

With Node.js 20+ and Python 3.10+:

```bash
npm test
```

No npm installation is necessary to run the tests. They cover solar geometry, time zones, rotated intersections, seasonal trees, thermal derating, clipping, demand totals, leap years, local-year completeness, energy conservation, payback/degradation and gateway privacy/cache behaviour. The calculation runs in a Web Worker so the UI stays responsive during annual simulations.
