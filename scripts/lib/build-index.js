import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";

/**
 * Scans public/marathons/*\/config.json (i.e. every marathon that has been
 * preprocessed at least once) and writes public/marathons/index.json, the
 * list the landing page (src/list.js) fetches.
 */
export function rebuildMarathonIndex() {
  const root = "public/marathons";
  if (!existsSync(root)) return;

  const entries = [];
  for (const folderName of readdirSync(root)) {
    const dir = `${root}/${folderName}`;
    if (!statSync(dir).isDirectory()) continue;

    const configPath = `${dir}/config.json`;
    if (!existsSync(configPath)) continue; // not (fully) processed yet, skip

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    entries.push({
      id: folderName,
      name: config.name,
      location: config.location,
      date: config.date,
      raceStartTimeMs: config.raceStartTimeMs,
    });
  }

  entries.sort((a, b) => (a.raceStartTimeMs || 0) - (b.raceStartTimeMs || 0));

  writeFileSync(`${root}/index.json`, JSON.stringify(entries));
  console.log(`\nMarathon index refreshed: ${entries.length} marathon(s) -> ${root}/index.json`);
}
