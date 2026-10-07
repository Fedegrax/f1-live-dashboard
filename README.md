# Pitwall Live

Timing, lap analysis, tyre strategy, telemetry and a live track map for every Formula 1 session since 2023.
Runs in the browser; the optional live relay is a single dependency-free Node file.

**Languages:** English · Italiano · Español · Français · Deutsch · Português

## What you get

| View | Contents |
|---|---|
| Dashboard | Your own page: pick widgets (live standings, lap times, pace, tyre degradation, championship, rain radar, positions, stints, weather, race control), drag or resize them, and the layout is saved in the browser. Presets for race, practice and qualifying. |
| Standings | Timing tower: best/last lap, gaps, sector colours, tyre and age, pit stops, top speed, Q1/Q2/Q3, grid. Click a driver for every lap and mini-sector. |
| Championship | Drivers' and constructors' tables with the points being earned in the current Race or Sprint shown in green, projected as if it ended now. |
| Rain radar | Weather radar for the last 2 hours and a model forecast up to 24 hours over the circuit, with an animated timeline and a rain-at-the-circuit summary. |
| Laps & pace | Lap-time chart, delta modes, pace distribution, tyre degradation by compound or team (optional fuel correction). |
| Sectors & speed | Best sectors, ideal lap, potential, speed traps and intermediates. |
| Strategy | Stint timeline with averages, stint comparison, tyre usage, pit stops. |
| Race | Position chart, gap to leader, grid vs finish (Sprint and Race). |
| Telemetry | Two-lap comparison: speed, throttle, brake, gear, time delta and a track map coloured by speed, gear, pedals or A/B dominance. |
| Map & replay | Car positions on track with replay (up to 30×) and a live mode. |
| Race control & weather | Flags and messages, temperatures, wind, humidity, team radio. |

The URL keeps year, Grand Prix, session and view, so a shared link opens the same page.

### On a phone

Compact mode switches on by itself on small screens (or from the menu): fewer columns, one-line header, bottom tab bar, larger touch targets. The app can be installed to the home screen (PWA), keeps the screen awake on request and shows how fresh the live data is.

## Live data

Historical data comes from [OpenF1](https://openf1.org). During a session OpenF1 reserves its live feed for subscribers, so there are two ways to see a session in real time:

1. **Live relay (free).** `server/server.js` connects to the same live-timing feed that drives the official F1 timing page, records the session in memory and serves it with the OpenF1 API shape. The dashboard prefers it while a session is live and falls back to OpenF1 afterwards, because OpenF1's record is complete.
2. **OpenF1 account.** Sign in from *Live access*. Credentials stay in the browser and go only to `api.openf1.org`.

Without either, a session's data becomes available shortly after it ends.

### Run the relay

```sh
npm run relay            # http://localhost:8080 (also serves the dashboard)
```

Open the dashboard from that address and it finds the relay by itself. To use the relay from a hosted copy of the dashboard, open *Live access* and paste the relay's public URL, or set `relayUrl` in `docs/config.js`.

The relay must be running when a session starts: it records laps as they happen and can't recover earlier ones if it joins late (the dashboard says so). It keeps a copy of the session on disk and resumes after a restart.

Deploy options: any machine that stays on (VPS, Raspberry Pi, your computer), the included `Dockerfile`, or `render.yaml` on an always-on plan. Free tiers that sleep when idle will miss laps. If a cloud host cannot reach the F1 feed, run the relay from a home connection instead.

### Try it without a session

`npm run replay -- <folder with *.jsonStream files> [speed] [port] [startMinute]` plays an archived session back as if it were live, using the F1 static archive files of any past session. `node scripts/replay-check.mjs <folder> <session_key>` replays one and compares every lap with OpenF1 (on the 2026 Malaysia race: 1142 of 1142 laps match).

## Hosting the dashboard

The site is the `docs/` folder: static files, no build step. Serve it with GitHub Pages (*Settings → Pages → Deploy from a branch → /docs*), any static host, or `npm start`.

Edit `docs/config.js` to set the donation link, repository link and default relay.

## Rate limits

Without an account the client keeps to OpenF1's free limits (about 27 requests per minute) with an internal queue and caches finished sessions in the browser.

## Development

```sh
npm start        # static dashboard on http://localhost:8080
npm test         # calculations, relay model and translation coverage
npm run snapshot # refresh docs/data/calendar.json (offline calendar fallback)
```

```
docs/            static site
  js/api.js        OpenF1 / relay client: queue, limits, login, IndexedDB cache
  js/data.js       pure calculations (tested)
  js/i18n/*.js     one dictionary per language
  js/views/*.js    one file per view
server/          live relay (feed client, model, HTTP)
scripts/         replay server, replay check, calendar snapshot
test/            unit tests and sample data
```

### Adding a language

Copy `docs/js/i18n/en.js` to `<code>.js`, translate the values and keep the `{placeholders}`, then add the code to `LANGS` in `docs/js/i18n.js`. `npm test` fails if a key or placeholder is missing.

## Rain radar sources

Past radar from [RainViewer](https://www.rainviewer.com), forecast from [Open-Meteo](https://open-meteo.com), base map from OpenStreetMap (set `mapTiles` in `docs/config.js` to use another tile provider). Radar resolution is about 1 km and the forecast grid about 10 km, so the radar shows whether and from where rain may reach the circuit, not individual corners.

## Disclaimer

Unofficial project, not affiliated with Formula 1, the FIA or any team. F1, FORMULA ONE, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V. Timing data is provided by OpenF1 and the live-timing feed; check their terms before building on it.

## License

MIT
