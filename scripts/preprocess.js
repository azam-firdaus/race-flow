// Preprocesses ONE marathon's raw data into the format the web app reads.
//
// Usage:
//   node scripts/preprocess.js <folder-name>
//   npm run preprocess -- <folder-name>
//
// Reads from:  marathons/<folder-name>/
// Writes to:   public/marathons/<folder-name>/
// Also refreshes public/marathons/index.json (the list every processed
// marathon, read by the landing page).
import { existsSync, mkdirSync, readdirSync } from "fs";
import { processRoute } from "./lib/process-route.js";
import { processCheckpointsAndRunners } from "./lib/process-checkpoints.js";
import { processRaceConfig } from "./lib/process-config.js";
import { rebuildMarathonIndex } from "./lib/build-index.js";

const folderName = process.argv[2];

if (!folderName) {
  console.error("Usage: npm run preprocess -- <folder-name>");
  console.error("Example: npm run preprocess -- malaysia_marathon");
  console.error("\nAvailable folders in marathons/:");
  try {
    for (const name of readdirSync("marathons")) console.error(`  ${name}`);
  } catch {
    console.error("  (none found — marathons/ directory doesn't exist yet)");
  }
  process.exit(1);
}

const inDir = `marathons/${folderName}`;
const outDir = `public/marathons/${folderName}`;

if (!existsSync(inDir)) {
  throw new Error(`No such folder: ${inDir}`);
}
mkdirSync(outDir, { recursive: true });

console.log(`Processing "${folderName}"\n`);

const totalDistanceKm = processRoute(inDir, outDir);
processCheckpointsAndRunners(inDir, outDir, totalDistanceKm);
processRaceConfig(inDir, outDir);

console.log(`\nDone. Output in ${outDir}/`);

rebuildMarathonIndex();
