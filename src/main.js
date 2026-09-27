import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import * as turf from "@turf/turf";

// ---------------------------------------------------------------------------
// 1. Which marathon? (?marathon=<folder-name> in the URL, set by the list page)
// ---------------------------------------------------------------------------
const marathonId = new URLSearchParams(window.location.search).get("marathon");
const backLinkEl = document.getElementById("back-link");
const raceTitleEl = document.getElementById("race-title");

if (!marathonId) {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:sans-serif;color:#f4f4f4;background:#14161a;height:100vh;">' +
    'No marathon selected. <a href="/" style="color:#ffd60a;">Go back to the list</a>.</div>';
  throw new Error("Missing ?marathon= query param");
}

const base = `/marathons/${marathonId}`;

async function fetchJsonOrFail(path, label) {
  const res = await fetch(path);
  if (!res.ok) {
    document.body.innerHTML =
      `<div style="padding:40px;font-family:sans-serif;color:#f4f4f4;background:#14161a;height:100vh;">` +
      `Couldn't load "${marathonId}" (${label} — HTTP ${res.status}). ` +
      `Has it been preprocessed yet? Run <code>npm run preprocess -- ${marathonId}</code>. ` +
      `<a href="/" style="color:#ffd60a;">Back to the list</a>.</div>`;
    throw new Error(`Failed to fetch ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 2. Load this marathon's preprocessed data (produced by `npm run preprocess`)
// ---------------------------------------------------------------------------
const [routeData, checkpoints, runnersData, config] = await Promise.all([
  fetchJsonOrFail(`${base}/route.json`, "route"),
  fetchJsonOrFail(`${base}/checkpoints.json`, "checkpoints"),
  fetchJsonOrFail(`${base}/runners.json`, "runners"),
  fetchJsonOrFail(`${base}/config.json`, "config"),
]);

document.title = `${config.name} — Marathon Tracker`;
raceTitleEl.textContent = config.name;
backLinkEl.href = "/";

const route = routeData.line;
const { checkpointOrder, runners } = runnersData;

if (checkpoints.length !== checkpointOrder.length) {
  console.warn(
    "checkpoints.json and runners.json checkpointOrder have different lengths — " +
      "make sure data/checkpoints-km.json matches your runner data's checkpoint list."
  );
}

// ---------------------------------------------------------------------------
// 3. Precompute each runner's (timestamp -> distanceKm) pairs, once,
//    skipping any missed/null checkpoint scans.
// ---------------------------------------------------------------------------
const runnerPairs = {}; // runnerId -> [[timestampMs, distanceKm], ...] sorted
const bibToRunnerId = {}; // "42" -> "R001"
let raceEndMs = -Infinity;

for (const [runnerId, runner] of Object.entries(runners)) {
  const pairs = [];
  for (let i = 0; i < runner.times.length; i++) {
    const t = runner.times[i];
    if (t == null) continue;
    pairs.push([t, checkpoints[i].distanceKm]);
    if (t > raceEndMs) raceEndMs = t;
  }
  pairs.sort((a, b) => a[0] - b[0]);
  runnerPairs[runnerId] = pairs;
  if (runner.bib != null) bibToRunnerId[String(runner.bib)] = runnerId;
}

// Race start is the official gun time from data/race-config.json, not
// whatever the earliest checkpoint scan happens to be (chip delay etc.).
const raceStartMs = config.raceStartTimeMs;
if (raceEndMs < raceStartMs) raceEndMs = raceStartMs; // guard against empty/bad data

// ---------------------------------------------------------------------------
// 4. Binary-search interpolation: race time -> distance along route -> lat/lon
// ---------------------------------------------------------------------------
function distanceAtTime(pairs, tMs) {
  if (pairs.length === 0) return null; // no valid scans for this runner at all
  if (tMs < pairs[0][0]) return null; // hasn't started yet
  const last = pairs[pairs.length - 1];
  if (tMs >= last[0]) return last[1];

  let lo = 0,
    hi = pairs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid][0] <= tMs) lo = mid;
    else hi = mid;
  }
  const [t0, d0] = pairs[lo];
  const [t1, d1] = pairs[hi];
  const frac = (tMs - t0) / (t1 - t0);
  return d0 + frac * (d1 - d0);
}

function positionAtTime(runnerId, tMs) {
  const pairs = runnerPairs[runnerId];
  const km = distanceAtTime(pairs, tMs);
  if (km == null) return null;
  return { position: positionAtDistance(km), distanceKm: km };
}

// --- Fast route lookup: precompute cumulative distance once, then binary
//     search + linear interpolation per query. This replaces calling
//     turf.along() per runner per frame, which re-walks the ENTIRE route
//     from the start on every single call — with thousands of runners that
//     is thousands x route-length work, 60 times a second, which is what
//     was freezing the page. This precompute-once approach is ~300x+ faster
//     at realistic runner counts and route sizes. ---
function buildRouteIndex(routeLine) {
  const coords = routeLine.geometry.coordinates;
  const cumulativeKm = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulativeKm.push(cumulativeKm[i - 1] + turf.distance(coords[i - 1], coords[i], { units: "kilometers" }));
  }
  return { coords, cumulativeKm };
}

const routeIndex = buildRouteIndex(route);

function positionAtDistance(km) {
  const { coords, cumulativeKm } = routeIndex;
  const total = cumulativeKm[cumulativeKm.length - 1];
  if (km <= 0) return coords[0];
  if (km >= total) return coords[coords.length - 1];

  let lo = 0,
    hi = cumulativeKm.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeKm[mid] <= km) lo = mid;
    else hi = mid;
  }
  const d0 = cumulativeKm[lo],
    d1 = cumulativeKm[hi];
  const frac = d1 > d0 ? (km - d0) / (d1 - d0) : 0;
  const [lon0, lat0] = coords[lo];
  const [lon1, lat1] = coords[hi];
  return [lon0 + (lon1 - lon0) * frac, lat0 + (lat1 - lat0) * frac];
}

// ---------------------------------------------------------------------------
// 5. Runner dot / path appearance (all adjustable via the Customize panel)
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const appearance = {
  dotColor: hexToRgb("#e63946"),
  dotRadius: 5,
  dotOpacity: 255, // 0-255, alpha channel for deck.gl colors
  pathColor: hexToRgb("#e63946"),
  pathWidth: 4,
  pathOpacity: 217, // 0-255, ~85%
};

// The route line is rendered as a deck.gl PathLayer (built once outside the
// render loop, since the route itself never changes) rather than a native
// MapLibre layer. This is what makes "map opacity" and "path opacity"
// independent: MapLibre's own canvas (the raster tiles) is one canvas, and
// deck.gl's overlay (dots + path) is a separate canvas drawn on top. Fading
// the tile canvas via CSS opacity never touches the path, because the path
// isn't on that canvas at all.
function buildPathLayer() {
  return new PathLayer({
    id: "route-path",
    data: [{ path: route.geometry.coordinates }],
    getPath: (d) => d.path,
    getColor: [...appearance.pathColor, appearance.pathOpacity],
    getWidth: appearance.pathWidth,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    parameters: { depthTest: false },
    updateTriggers: {
      getColor: `${appearance.pathColor.join(",")}-${appearance.pathOpacity}`,
      getWidth: appearance.pathWidth,
    },
  });
}

// ---------------------------------------------------------------------------
// 6. Map + route line
// ---------------------------------------------------------------------------
const [centerLon, centerLat] = turf.center(route).geometry.coordinates;

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  },
  center: [centerLon, centerLat],
  zoom: 14,
});

map.addControl(new maplibregl.NavigationControl(), "top-left");

const overlay = new MapboxOverlay({ layers: [] });

map.on("load", () => {
  const bounds = turf.bbox(route);
  map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    { padding: 60, duration: 0 }
  );

  map.addControl(overlay);
  applyMapFilter(); // apply default tint/opacity settings once the canvas exists
  renderCheckpointMarkers(); // distance labels at each checkpoint, from checkpoints.json
});

// --- Map tint: CSS filter applied to maplibre's own canvas only, so the
//     deck.gl runner-dot overlay (a separate canvas) is never recolored. ---
const MAP_STYLE_PRESETS = {
  standard: "",
  dark: "invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9)",
  grayscale: "grayscale(1)",
  sepia: "sepia(0.6) saturate(1.3)",
};

function applyMapFilter() {
  const canvas = document.querySelector("#map canvas.maplibregl-canvas");
  if (!canvas) return;
  const preset = MAP_STYLE_PRESETS[mapStyleEl.value] || "";
  const hue = Number(mapHueEl.value);
  canvas.style.filter = hue ? `${preset} hue-rotate(${hue}deg)`.trim() : preset;
  canvas.style.opacity = String(Number(mapOpacityEl.value) / 100);
}

// ---------------------------------------------------------------------------
// 7. Race clock + animation state
// ---------------------------------------------------------------------------
const runnerIds = Object.keys(runners);

const scrubEl = document.getElementById("scrub");
const clockEl = document.getElementById("race-clock");
const playPauseEl = document.getElementById("play-pause");
const speedEl = document.getElementById("speed");
const countEl = document.getElementById("runner-count");
const searchFormEl = document.getElementById("search-form");
const bibInputEl = document.getElementById("bib-input");
const searchStatusEl = document.getElementById("search-status");
const clearHighlightEl = document.getElementById("clear-highlight");
const followLabelEl = document.getElementById("follow-label");
const followToggleEl = document.getElementById("follow-toggle");
const mapStyleEl = document.getElementById("map-style");
const mapHueEl = document.getElementById("map-hue");
const mapOpacityEl = document.getElementById("map-opacity");
const customizeToggleEl = document.getElementById("customize-toggle");
const customizePanelEl = document.getElementById("customize-panel");
const dotColorEl = document.getElementById("dot-color");
const dotSizeEl = document.getElementById("dot-size");
const dotOpacityEl = document.getElementById("dot-opacity");
const pathColorEl = document.getElementById("path-color");
const pathWidthEl = document.getElementById("path-width");
const pathOpacityEl = document.getElementById("path-opacity");
const panelToggleEl = document.getElementById("panel-toggle");
const panelBodyEl = document.getElementById("panel-body");
const runnerInfoPanelEl = document.getElementById("runner-info-panel");
const runnerInfoNameEl = document.getElementById("runner-info-name");
const runnerInfoBibEl = document.getElementById("runner-info-bib");
const runnerInfoDistanceEl = document.getElementById("runner-info-distance");
const runnerInfoPaceEl = document.getElementById("runner-info-pace");
const leaderboardPanelEl = document.getElementById("leaderboard-panel");
const leaderboardListEl = document.getElementById("leaderboard-list");

countEl.textContent = `${runnerIds.length} runners`;
scrubEl.min = 0;
scrubEl.max = raceEndMs - raceStartMs;

let raceTimeMs = raceStartMs;
let playing = true;
let speedMultiplier = Number(speedEl.value);
let lastFrameWallClock = performance.now();
let userIsScrubbing = false;
let highlightedRunners = []; // ordered runnerIds; index 0 is the "primary" (search focus, camera, info panel)

// Distinct colors so multiple highlighted runners stay visually separable.
// Index 0 (gold) is always the primary/first-searched runner.
const HIGHLIGHT_COLORS = [
  [255, 214, 10], // gold - primary
  [0, 212, 255], // cyan
  [255, 94, 174], // pink
  [124, 255, 94], // lime
  [255, 159, 28], // orange
  [186, 104, 255], // purple
];
function colorForHighlightIndex(i) {
  return HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length];
}

function formatClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Trail: recomputed fresh from the interpolation function every frame using
// a fixed look-back window in race-time. No accumulated history needed, so
// scrubbing/rewinding the race clock "just works" for the trail too.
const TRAIL_LOOKBACK_MS = 4 * 60 * 1000; // last 4 race-minutes
const TRAIL_STEPS = 20;

function computeTrail(runnerId, currentMs) {
  const trail = [];
  for (let i = TRAIL_STEPS; i >= 1; i--) {
    const t = currentMs - (i / TRAIL_STEPS) * TRAIL_LOOKBACK_MS;
    if (t < raceStartMs) continue;
    const result = positionAtTime(runnerId, t);
    if (result) trail.push({ position: result.position, age: i / TRAIL_STEPS }); // age: ~1 oldest -> ~0 newest
  }
  return trail;
}

// --- Pace: minutes per km over the segment the runner is currently in
//     (between the two surrounding checkpoint scans) — reflects their recent
//     speed, not a race-long average. Same binary-search shape as
//     distanceAtTime, just returning the segment instead of an interpolated
//     distance. ---
function paceMinPerKmAtTime(pairs, tMs) {
  if (pairs.length < 2) return null;
  if (tMs < pairs[0][0]) return null; // not started yet

  let i0, i1;
  if (tMs >= pairs[pairs.length - 1][0]) {
    i0 = pairs.length - 2;
    i1 = pairs.length - 1; // finished: report pace of the final segment
  } else {
    let lo = 0,
      hi = pairs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid][0] <= tMs) lo = mid;
      else hi = mid;
    }
    i0 = lo;
    i1 = hi;
  }

  const [t0, d0] = pairs[i0];
  const [t1, d1] = pairs[i1];
  const dKm = d1 - d0;
  if (dKm <= 0) return null; // guard against a zero-distance segment (shouldn't happen, but don't divide by 0)
  return (t1 - t0) / 60000 / dKm;
}

function formatPace(minPerKm) {
  if (minPerKm == null || !isFinite(minPerKm) || minPerKm <= 0) return "--:--";
  const totalSec = Math.round(minPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s} /km`;
}

// --- Top-right info panel: always shows the primary (first-searched)
//     highlighted runner, live. ---
function updateRunnerInfoPanel() {
  if (highlightedRunners.length === 0) {
    runnerInfoPanelEl.hidden = true;
    return;
  }
  const primaryId = highlightedRunners[0];
  const runner = runners[primaryId];
  const pairs = runnerPairs[primaryId];
  const km = distanceAtTime(pairs, raceTimeMs);
  const pace = paceMinPerKmAtTime(pairs, raceTimeMs);

  runnerInfoNameEl.textContent = runner.name || "(no name)";
  runnerInfoBibEl.textContent = runner.bib != null ? `Bib ${runner.bib}` : "";
  runnerInfoDistanceEl.textContent = km == null ? "Not started" : `${km.toFixed(2)} km`;
  runnerInfoPaceEl.textContent = formatPace(pace);
  runnerInfoPanelEl.hidden = false;
}

// --- Leaderboard: only appears once a 2nd runner is highlighted, ranks
//     every currently-highlighted runner by live distance. ---
function updateLeaderboard() {
  if (highlightedRunners.length < 2) {
    leaderboardPanelEl.hidden = true;
    return;
  }

  const entries = highlightedRunners.map((id, i) => ({
    id,
    colorIndex: i,
    km: distanceAtTime(runnerPairs[id], raceTimeMs) ?? 0,
    bib: runners[id].bib,
    name: runners[id].name,
  }));
  entries.sort((a, b) => b.km - a.km);

  leaderboardListEl.innerHTML = "";
  entries.forEach((e, rank) => {
    const row = document.createElement("div");
    row.className = "leaderboard-row";

    const swatch = document.createElement("span");
    swatch.className = "leaderboard-swatch";
    swatch.style.background = `rgb(${colorForHighlightIndex(e.colorIndex).join(",")})`;
    row.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "leaderboard-label";
    const prefix = rank === 0 ? "\u{1F3C6} " : "";
    label.textContent = `${prefix}${e.bib != null ? "#" + e.bib : e.id}${e.name ? " " + e.name : ""}`;
    row.appendChild(label);

    const dist = document.createElement("span");
    dist.className = "leaderboard-distance";
    dist.textContent = `${e.km.toFixed(2)} km`;
    row.appendChild(dist);

    leaderboardListEl.appendChild(row);
  });

  leaderboardPanelEl.hidden = false;
}

function render(nowWallMs) {
  const activeRunners = [];
  for (const runnerId of runnerIds) {
    const result = positionAtTime(runnerId, raceTimeMs);
    if (result) activeRunners.push({ runnerId, position: result.position, distanceKm: result.distanceKm });
  }

  const highlightedSet = new Set(highlightedRunners);
  const normalRunners = activeRunners.filter((r) => !highlightedSet.has(r.runnerId));

  const layers = [
    buildPathLayer(),
    new ScatterplotLayer({
      id: "runners",
      data: normalRunners,
      getPosition: (d) => d.position,
      getRadius: appearance.dotRadius,
      radiusUnits: "pixels",
      getFillColor: [...appearance.dotColor, appearance.dotOpacity],
      getLineColor: [255, 255, 255, appearance.dotOpacity],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      stroked: true,
      updateTriggers: {
        getPosition: raceTimeMs,
        getFillColor: `${appearance.dotColor.join(",")}-${appearance.dotOpacity}`,
        getRadius: appearance.dotRadius,
      },
    }),
  ];

  if (highlightedRunners.length > 0) {
    const primaryId = highlightedRunners[0];
    const primary = activeRunners.find((r) => r.runnerId === primaryId);

    if (primary) {
      const trail = computeTrail(primaryId, raceTimeMs);
      layers.push(
        new ScatterplotLayer({
          id: "highlight-trail",
          data: trail,
          getPosition: (d) => d.position,
          getRadius: (d) => 2 + (1 - d.age) * 5,
          radiusUnits: "pixels",
          getFillColor: (d) => [...HIGHLIGHT_COLORS[0], Math.round((1 - d.age) * 180)],
          updateTriggers: { getPosition: raceTimeMs },
        })
      );

      // Subtle pulse so the primary highlighted dot is unmistakable.
      const pulse = 1 + 0.15 * Math.sin(nowWallMs / 250);
      layers.push(
        new ScatterplotLayer({
          id: "highlight-dot",
          data: [primary],
          getPosition: (d) => d.position,
          getRadius: 11 * pulse,
          radiusUnits: "pixels",
          getFillColor: HIGHLIGHT_COLORS[0],
          getLineColor: [255, 255, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          stroked: true,
          updateTriggers: { getPosition: raceTimeMs, getRadius: pulse },
        })
      );

      if (followToggleEl.checked) {
        map.jumpTo({ center: primary.position });
      }
    }

    // Additional highlighted runners (bib #2, #3, ...) - just a bigger dot
    // in their own color, no trail/pulse/camera/info-panel treatment.
    const secondaryPoints = [];
    for (let i = 1; i < highlightedRunners.length; i++) {
      const r = activeRunners.find((a) => a.runnerId === highlightedRunners[i]);
      if (r) secondaryPoints.push({ position: r.position, color: colorForHighlightIndex(i) });
    }
    if (secondaryPoints.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "highlight-secondary",
          data: secondaryPoints,
          getPosition: (d) => d.position,
          getRadius: 9,
          radiusUnits: "pixels",
          getFillColor: (d) => d.color,
          getLineColor: [255, 255, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          stroked: true,
          updateTriggers: { getPosition: raceTimeMs },
        })
      );
    }
  }

  overlay.setProps({ layers });

  clockEl.textContent = formatClock(raceTimeMs - raceStartMs);
  if (!userIsScrubbing) scrubEl.value = String(raceTimeMs - raceStartMs);

  updateRunnerInfoPanel();
  updateLeaderboard();
}

function tick(now) {
  const wallDeltaMs = now - lastFrameWallClock;
  lastFrameWallClock = now;

  if (playing) {
    raceTimeMs = Math.min(raceEndMs, raceTimeMs + wallDeltaMs * speedMultiplier);
    if (raceTimeMs >= raceEndMs) playing = false, (playPauseEl.textContent = "Play");
  }

  render(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------------------------------------------------------------------
// 8. UI wiring
// ---------------------------------------------------------------------------
playPauseEl.addEventListener("click", () => {
  playing = !playing;
  playPauseEl.textContent = playing ? "Pause" : "Play";
  lastFrameWallClock = performance.now();
});

speedEl.addEventListener("change", () => {
  speedMultiplier = Number(speedEl.value);
});

scrubEl.addEventListener("input", () => {
  userIsScrubbing = true;
  raceTimeMs = raceStartMs + Number(scrubEl.value);
  render(performance.now());
});
scrubEl.addEventListener("change", () => {
  userIsScrubbing = false;
  lastFrameWallClock = performance.now();
});

searchFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const bib = bibInputEl.value.trim();
  if (!bib) return;

  const runnerId = bibToRunnerId[bib];
  if (!runnerId) {
    searchStatusEl.textContent = `No runner found with bib "${bib}".`;
    searchStatusEl.className = "not-found";
    return;
  }
  if (highlightedRunners.includes(runnerId)) {
    searchStatusEl.textContent = `Bib ${bib} is already highlighted.`;
    searchStatusEl.className = "not-found";
    return;
  }

  const isPrimary = highlightedRunners.length === 0;
  highlightedRunners.push(runnerId);

  const runner = runners[runnerId];
  searchStatusEl.textContent = `Highlighting bib ${bib}${runner.name ? " — " + runner.name : ""}.`;
  searchStatusEl.className = "found";
  clearHighlightEl.hidden = false;
  bibInputEl.value = "";

  if (isPrimary) {
    // Only the first-searched runner gets camera focus, follow, and the info panel.
    followLabelEl.hidden = false;
    followToggleEl.checked = true;
    const result = positionAtTime(runnerId, raceTimeMs);
    if (result) map.easeTo({ center: result.position, zoom: Math.max(map.getZoom(), 15), duration: 600 });
  }

  updateRunnerInfoPanel();
  updateLeaderboard();
});

clearHighlightEl.addEventListener("click", () => {
  highlightedRunners = [];
  bibInputEl.value = "";
  searchStatusEl.textContent = "";
  searchStatusEl.className = "";
  clearHighlightEl.hidden = true;
  followLabelEl.hidden = true;
  followToggleEl.checked = false;
  runnerInfoPanelEl.hidden = true;
  leaderboardPanelEl.hidden = true;
});

mapStyleEl.addEventListener("change", applyMapFilter);
mapHueEl.addEventListener("input", applyMapFilter);
mapOpacityEl.addEventListener("input", applyMapFilter);

customizeToggleEl.addEventListener("click", () => {
  customizePanelEl.hidden = !customizePanelEl.hidden;
  customizeToggleEl.textContent = customizePanelEl.hidden ? "Customize" : "Hide customize";
});

panelToggleEl.addEventListener("click", () => {
  const collapsed = !panelBodyEl.hidden;
  panelBodyEl.hidden = collapsed;
  panelToggleEl.textContent = collapsed ? "+" : "\u2212";
  panelToggleEl.title = collapsed ? "Expand" : "Minimize";
});

// --- Dot appearance: read straight into the `appearance` object; render()
//     picks these up on the very next animation frame, no extra plumbing. ---
dotColorEl.addEventListener("input", () => {
  appearance.dotColor = hexToRgb(dotColorEl.value);
});
dotSizeEl.addEventListener("input", () => {
  appearance.dotRadius = Number(dotSizeEl.value);
});
dotOpacityEl.addEventListener("input", () => {
  appearance.dotOpacity = Math.round((Number(dotOpacityEl.value) / 100) * 255);
});

// --- Path appearance: also just state read by buildPathLayer() each frame,
//     same pattern as dots — now that the route is a deck.gl layer instead
//     of a native MapLibre one, there's no separate paint API to call. ---
pathColorEl.addEventListener("input", () => {
  appearance.pathColor = hexToRgb(pathColorEl.value);
});
pathWidthEl.addEventListener("input", () => {
  appearance.pathWidth = Number(pathWidthEl.value);
});
pathOpacityEl.addEventListener("input", () => {
  appearance.pathOpacity = Math.round((Number(pathOpacityEl.value) / 100) * 255);
});
