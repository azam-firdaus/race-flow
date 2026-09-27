import { readFileSync, writeFileSync } from "fs";

/** Reads <inDir>/checkpoints-km.json + runners-raw.json, writes checkpoints.json + runners.json to <outDir>. */
export function processCheckpointsAndRunners(inDir, outDir, totalDistanceKm) {
  const checkpointKms = JSON.parse(readFileSync(`${inDir}/checkpoints-km.json`, "utf8"));
  const runnersRaw = JSON.parse(readFileSync(`${inDir}/runners-raw.json`, "utf8"));

  const sortedKms = [...checkpointKms].sort((a, b) => a - b);
  if (JSON.stringify(sortedKms) !== JSON.stringify(checkpointKms)) {
    console.warn(`Warning: ${inDir}/checkpoints-km.json wasn't sorted ascending — sorting it for you.`);
  }

  const checkpoints = sortedKms.map((km) => {
    if (km < 0 || km > totalDistanceKm) {
      throw new Error(`Checkpoint at ${km}km is outside the route (route is ${totalDistanceKm.toFixed(2)}km long).`);
    }
    const label = km === 0 ? "Start" : km === totalDistanceKm ? "Finish" : `${km} km`;
    return { id: String(km), name: label, distanceKm: km };
  });

  writeFileSync(`${outDir}/checkpoints.json`, JSON.stringify(checkpoints));
  console.log(`Checkpoints (route is ${totalDistanceKm.toFixed(2)}km total):`);
  for (const cp of checkpoints) console.log(`  ${cp.id.padEnd(6)} ${cp.name}`);

  writeFileSync(`${outDir}/runners.json`, JSON.stringify(runnersRaw));
  console.log(`${Object.keys(runnersRaw.runners).length} runners -> ${outDir}/runners.json`);
}
