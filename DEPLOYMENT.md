# Public hosting

Prepared for a small, noncommercial public beta. Nothing has been published and no hosting account, paid resource or domain has been created.

## Temporary sharing

Install [`cloudflared`](https://developers.cloudflare.com/tunnel/downloads/) and make it available on your `PATH`. From the calculator project folder, run:

```sh
python3 share.py
```

Send the printed HTTPS link and password to your friends. Anyone who receives both can open the calculator. Leave the command running until each friend sees **Ready to use in this browser after the host closes the link**. Press Ctrl+C to close the tunnel. New visitors need a new link. Friends who finished loading the calculator can still use it and reopen the same address in the same browser profile while the copy remains in browser storage.

Map and weather downloads go directly from each friend's browser to Overpass and Open-Meteo, using their connection and the same coarse area or rounded coordinates used in the regular app. New downloads require internet access and a response from the provider. GeoJSON and saved weather imports still work with local files. Each new sharing run generates a new address. Friends can use **Save project** and **Open project** to carry their work to the new address or a different browser.

## Hosting options checked on 30 October 2026

| Host | Current free offer | Fit for this application |
| --- | --- | --- |
| [Northflank Sandbox](https://northflank.com/pricing) | No card needed; always on; up to $20/month of resources across two services, two jobs and one database | First choice to try. One small Northflank Cloud service is sufficient; keep its displayed cost within the Sandbox allowance. Do not choose BYOC: your own cloud would bill separately. |
| [Alwaysdata Free](https://www.alwaysdata.com/en/offers/) | Personal use; €0/month; 1 GB storage, 256 MB RAM, ¼ CPU | Another candidate. [Python WSGI hosting](https://help.alwaysdata.com/en/docs/web-hosting/languages/python/configuration/) is supported. Prefer the User program option running Gunicorn, because download jobs require threads and a single process. Verify provider connectivity and memory with a representative area before sharing widely. |
| [Render Free](https://render.com/docs/free) | Free Python web service; sleeps after 15 minutes; disposable disk | Compatible with the same container. Repeated downloads after restarts and a roughly one-minute cold start are the tradeoffs. Without a payment method, documented bandwidth overages suspend services rather than charge. Heavy service-initiated traffic can also cause suspension. |
| [Koyeb](https://www.koyeb.com/docs/faqs/pricing) | A free 512 MB instance exists | Poor fit for a strict no-payment requirement. Current signup documentation requires a card and describes charging the initially selected Pro plan. |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/) | A free tier exists, with tight CPU/memory limits | Requires a different backend architecture. This container and its threaded Python jobs cannot be deployed unchanged as a Worker. |

These are current vendor offers, not guarantees of future availability. The recommendations above are an assessment of the architecture; no real account deployment has been tested. Free tiers are appropriate for a hobby preview, without uptime guarantees. A provider's own API restrictions or shared-IP rate limits can still prevent a download.

## Deploy the container on Northflank, Render, or another container host

1. Extract `dist/solstice-public.tar.gz` into a fresh directory and upload its contents to a source repository you control. A private repository works if your host supports connecting it.
2. Create **one** web service using the included `Dockerfile`. On Northflank choose the free **Sandbox** plan and Northflank Cloud, with a small service within the displayed allowance. No database, background-worker service or persistent disk is needed. Stay on free resources; do not add payment details or enable paid upgrades to satisfy this zero-budget setup.
3. Enable the host's public HTTPS endpoint on container port **8080**. If the provider supplies a `PORT` environment variable, the server uses it automatically; configure routing/health checks to that port.
4. Set `SOLSTICE_PUBLIC_ORIGIN` to exactly the supplied HTTPS origin, for example `https://your-generated-name.example`. Include no path. If the hostname is allocated after creation, update this setting and redeploy before the service can start successfully. The app intentionally refuses to start without an explicit HTTPS origin.
5. Set the HTTP health check to `/api/health`. Deploy. Visit the HTTPS address, complete setup, generate an OSM scene, load a weather year, and reload to check that browser storage restores the project. Check memory and provider connectivity in the host dashboard. HTTPS is terminated by the managed hosting edge; do not expose the container directly on the internet.

The Docker image runs as a non-root user. The host supplies the free hostname and certificate. A custom domain is optional and unnecessary.

Run `python3 tools/check_hosted.py https://YOUR-SITE` for health, assets, runtime, diagnostics-privacy and same-origin checks. Add `--downloads` to explicitly test sample map/weather downloads and segmented integrity checks; this contacts the public data providers and consumes the site's allowance.

## Hosts with a native Python runtime

Use Python **3.13**, build with `pip install -r requirements.txt`, and start:

```sh
gunicorn --config gunicorn.conf.py wsgi:application
```

Set the same `SOLSTICE_PUBLIC_ORIGIN`, plus the host's port if it is not supplied automatically. `.env.example` lists the configuration; it is a reference, not a file loaded automatically.

Gunicorn binds to `0.0.0.0:$PORT` (8080 by default). For Alwaysdata's **User program** site, use the IP address and port shown in the site configuration: set `SOLSTICE_BIND` to that IP (wrap an IPv6 value in brackets), set `PORT` to the provided port, and use the full path to the virtual environment's `gunicorn` executable. Enter your actual allocated values in its environment settings. Its [User program documentation](https://help.alwaysdata.com/en/docs/web-hosting/sites/http-servers/user-program/) describes these settings. An alternative managed WSGI server may import `wsgi:application`, but must enable Python threads and use exactly one worker process; unverified default uWSGI settings are not sufficient.

## Resource and privacy behavior

- Exactly **one worker process / one replica**, with eight request threads. Jobs, rate limits and transfer parts live in that process. Adding workers or replicas would require shared job storage and rate limiting; do not change those settings in this version.
- One concurrent map download and one concurrent weather-year download; a different request receives a retry message while the slot is busy. Matching active requests reuse the same job. Up to three completed results of each kind are retained, expiring 15 minutes after completion. Job tokens are random and unguessable.
- Public-data caches use `/tmp/solstice-cache` by default: up to 32 MiB each for map and weather, pruned on writes. Map data expires after seven days; hosted weather cache reads expire after 30 days. Cache loss on sleep/restart is harmless: successful browser weather downloads remain in IndexedDB. Failed disk-cache writes do not discard successful downloads.
- Hosted map download limits: 8 MB uncompressed per Overpass response, or 16 MB per fixed OSM fallback quadrant (each is resolved and compacted before the next is read); completed result transfers are capped at 20 MB. Dense areas can exceed these limits and require an offline geometry import. The area is never silently narrowed around the precise private point.
- API limits: 240 requests/minute per connection IP and 1,200/minute overall; map starts 6/hour per connection IP and 30/hour overall; weather starts 30/hour per connection IP and 120/hour overall. Behind a host proxy, several visitors may share that connection IP. Forwarded IP headers are deliberately not trusted. Rate-limit keys are salted hashes held in memory; quotas reset on restart and are a basic small-beta control, not a substitute for platform abuse protection.
- Public mode accepts only the configured Host and same-origin JSON POSTs. Body size is capped at 1 KiB. The gateway has fixed upstream services and accepts no arbitrary fetch URL. Legacy synchronous download routes and client diagnostic uploads are disabled. Public diagnostics expose no other visitor's requests.
- Projects, costs, consumption, selected building and edited geometry stay in browser storage. The exact map point is used only in the browser. The host receives IP addresses, ordinary page requests, coarse map area indices and rounded weather requests; upstream data providers see the server's IP. Hosting providers may keep access logs under their own policies. No analytics, account system, external fonts or GPS access is included.
- Hosted connection observations stay in the browser and are exported only when the visitor chooses Save diagnostic report. Locally running `server.py` retains its metadata-only loopback troubleshooting behavior.
- Open-Meteo's free API is for noncommercial use and can rate-limit shared hosting IPs. Keep its attribution and the OSM attribution visible. See [Open-Meteo terms](https://open-meteo.com/en/terms). This app's estimates are not measured generation data.

## Local development and packaging

The ordinary local version still needs no Python packages:

```sh
python3 server.py --port 8766
```

Create the sanitized upload archive:

```sh
python3 tools/package_release.py
```

This writes `dist/solstice-public.tar.gz` with only the listed application files, assets and deployment instructions. Archive entries use relative paths, neutral ownership and fixed timestamps. The bundled third-party licence is included. The app source currently has no open-source licence.
