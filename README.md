# Marathon Tracker (demo)

A list page of marathons, and an animated map per marathon: a dot per runner
moves along the route, computed from checkpoint timestamps. Ships with one
demo marathon (10 runners on a ~4km loop) so you can see it working before
adding your own.

## What's in here

```
marathons/                        <- one folder per race, RAW input data
  malaysia_marathon/
    race-config.json              <- name, date, location, gun-start time
    route.gpx                     <- the race route
    checkpoints-km.json           <- checkpoint marks, e.g. [0, 5, 10, 21.1]
    runners-raw.json              <- runner bib + checkpoint timestamps
scripts/
  preprocess.js                   <- entry point, takes a folder name
  lib/                            <- the actual processing steps
  generate-sample-runners.js      <- makes fake demo data, not needed for real use
src/
  list.js, list.css               <- the marathon list page (index.html)
  main.js, style.css              <- the map viewer page (race.html)
public/marathons/                 <- generated output, don't hand-edit
index.html                        <- list page
race.html                         <- map viewer page
```

## 1. Install

```bash
npm install
```

(If you're on Windows PowerShell and a command with an `@` in a package name
throws a "splatting operator" error, wrap the package name in quotes, e.g.
`npm i "@deck.gl/core"` — that's a PowerShell parsing quirk, not this project.)

## 2. Try it with the sample data first

```bash
npm run preprocess -- malaysia_marathon
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). You'll see a list
with one marathon card — click it to open the map, with a red route line and
dots animating along it. Use the play/pause button, speed dropdown, scrub
bar, bib search, and map tint controls at the bottom left.

If nothing shows up: open the browser console (F12) first — it'll usually
tell you exactly which fetch or field is wrong.

## 3. Add your own marathon

Make a new folder under `marathons/`, named whatever you want the race's URL
slug to be (letters, numbers, underscores — this becomes part of the web
address, so avoid spaces):

```bash
mkdir marathons/klcc_night_run
```

Inside it, add four files:

**`race-config.json`** — the race's basic info and official gun-start time:

```json
{
  "name": "KLCC Night Run",
  "location": "Kuala Lumpur, Malaysia",
  "date": "2026-11-01",
  "raceStartTime": "2026-11-01T19:00:00+08:00",
  "description": "optional, not shown yet but reserved for later"
}
```

`raceStartTime` accepts UTC (`...Z`) or an explicit offset like `+08:00` —
both parse correctly. This is the actual gun time, used as the baseline for
the clock — keep it separate from whatever a runner's first checkpoint scan
happens to be (chip delay, mat timing, etc).

**`route.gpx`** — the race route. Must contain a `<trk><trkseg>` with
`<trkpt>` points — the standard GPX track format most GPS/route tools export.

**`checkpoints-km.json`** — just the km marks, in course order, no
coordinates needed:

```json
[0, 5, 10, 15, 21.1, 30, 40, 42.195]
```

**`runners-raw.json`** — runner bib numbers and checkpoint timestamps:

```json
{
  "checkpointOrder": ["0", "5", "10", "15", "21.1", "30", "40", "42.195"],
  "runners": {
    "R001": { "bib": "42", "name": "optional", "times": [1735200000000, 1735200610000, null, ..., 1735204000000] }
  }
}
```

- `checkpointOrder` items are `String(km)` for each value in
  `checkpoints-km.json`, in the same order (e.g. `"21.1"` not `"21.1km"`).
- `times[i]` is the epoch-**millisecond** timestamp the runner passed
  `checkpointOrder[i]`, or `null` if that checkpoint was missed/not recorded.
  (Common gotcha: Python's `datetime.timestamp()` returns seconds, not
  milliseconds — multiply by 1000, and make sure the datetime is
  timezone-aware so it isn't silently interpreted in your machine's local
  timezone.)

**If your raw export is instead a flat list of scans** like
`[{ "runnerId": "R001", "checkpointId": "10", "timestamp": "2026-11-01T19:41:00+08:00" }, ...]`,
convert it to the shape above first:

```js
// convert-flat-scans.js
import { readFileSync, writeFileSync } from "fs";
const scans = JSON.parse(readFileSync("flat-scans.json", "utf8"));
const checkpointOrder = ["0", "5", "10", "15", "21.1", "30", "40", "42.195"]; // your real order

const runners = {};
for (const s of scans) {
  runners[s.runnerId] ??= { times: new Array(checkpointOrder.length).fill(null) };
  const idx = checkpointOrder.indexOf(s.checkpointId);
  runners[s.runnerId].times[idx] = new Date(s.timestamp).getTime();
}
writeFileSync("marathons/klcc_night_run/runners-raw.json", JSON.stringify({ checkpointOrder, runners }));
```

Then process just that folder:

```bash
npm run preprocess -- klcc_night_run
npm run dev
```

It'll show up on the list page automatically — no other wiring needed. Each
marathon is processed independently; re-running `preprocess` for one folder
never touches another's data.

## 4. Build for deployment

```bash
npm run build
```

Outputs a static site in `dist/` — upload as-is to Netlify, Vercel, GitHub
Pages, S3, or any static host. No backend/server needed for replay mode.
Remember to run `npm run preprocess -- <folder>` for every marathon **before**
building — the build only bundles what's already in `public/marathons/`.

## Notes & gotchas

- **`npm run preprocess -- <folder>` must be re-run** any time you change
  that marathon's files under `marathons/<folder>/`. The app reads from
  `public/marathons/<folder>/`, not `marathons/<folder>/` directly.
- **The list page rebuilds automatically.** Every time you preprocess any
  marathon, `public/marathons/index.json` (what the list page reads) gets
  regenerated by scanning all already-processed marathons — you never edit
  it by hand.
- **A race only appears in the list once it's been preprocessed.** Adding a
  folder under `marathons/` alone isn't enough — run
  `npm run preprocess -- <folder-name>` at least once.
- **OpenStreetMap's own tile server** (`tile.openstreetmap.org`, used in
  `src/main.js`) is fine for development but its usage policy asks that
  production apps not hit it directly at volume. For a real public deploy,
  swap the `tiles` URL for a provider like MapTiler or Stadia Maps (both have
  free tiers built on OSM data).
- **Checkpoint order matters.** The preprocessor errors out if a checkpoint's
  km value is outside the route's actual length, and warns if
  `checkpoints-km.json` wasn't sorted ascending.
- **Performance at scale:** runner positions are computed via a precomputed
  cumulative-distance lookup (binary search), not a per-frame route walk —
  this comfortably handles several thousand runners animating at once.
