// Generates fake raw checkpoint scans so the demo has something to animate.
// Real usage: skip this script entirely — you'll have your own raw scan
// export (CSV/JSON from race timing software) shaped like the output below:
//   { runnerId, checkpointId, timestamp }
//
// Run: node scripts/generate-sample-runners.js
import { readFileSync, writeFileSync } from "fs";

// IDs must match what preprocess-checkpoints.js generates: String(km).
const checkpointKms = JSON.parse(readFileSync("data/checkpoints-km.json", "utf8"));
const checkpointOrder = [...checkpointKms].sort((a, b) => a - b).map(String);
const raceStart = Date.UTC(2026, 8, 1, 1, 0, 0); // 2026-09-01 09:00 local (UTC+8)

const names = [
  "A. Rahman", "S. Tan", "N. Kumar", "L. Wong", "F. Ibrahim",
  "J. Lim", "M. Chong", "R. Devi", "K. Yusof", "P. Ng"
];

const runners = {};
for (let i = 0; i < names.length; i++) {
  const runnerId = `R${String(i + 1).padStart(3, "0")}`;
  const paceMsPerKm = (4 + Math.random() * 3) * 60 * 1000; // 4-7 min/km
  const startOffset = Math.random() * 30 * 1000; // staggered gun start, within 30s

  const sortedKms = [...checkpointKms].sort((a, b) => a - b);
  const times = sortedKms.map((km, idx) => {
    // ~5% chance a mat is "missed" (except start/finish) to demo the null case
    if (idx > 0 && idx < sortedKms.length - 1 && Math.random() < 0.05) {
      return null;
    }
    const jitter = (Math.random() - 0.5) * 20 * 1000;
    return Math.round(raceStart + startOffset + km * paceMsPerKm + jitter);
  });

  runners[runnerId] = { bib: `${100 + i}`, name: names[i], times };
}

writeFileSync(
  "data/runners-raw.json",
  JSON.stringify({ checkpointOrder, runners }, null, 2)
);
console.log(`Generated ${names.length} sample runners -> data/runners-raw.json`);
