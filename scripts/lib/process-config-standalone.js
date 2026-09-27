import { existsSync, readFileSync, writeFileSync } from "fs";

const folderName = process.argv[2];
const inDir = `marathons/${folderName}`;
const outDir = `public/marathons/${folderName}`;

if (!existsSync(inDir)) {
  throw new Error(`No such folder: ${inDir}`);
}

processRaceConfig(inDir, outDir);

/** Reads <inDir>/race-config.json, writes <outDir>/config.json with Malaysia-local start time. */
export function processRaceConfig(inDir, outDir) {
  const raw = JSON.parse(readFileSync(`${inDir}/race-config.json`, "utf8"));

  if (!raw.raceStartTime) {
    throw new Error(`${inDir}/race-config.json: "raceStartTime" is required.`);
  }
  if (!raw.name) {
    throw new Error(`${inDir}/race-config.json: "name" is required (shown on the marathon list page).`);
  }

  // Interpret raceStartTime as Malaysia local time (UTC+8)
  const [year, month, day, hour, minute, second] = raw.raceStartTime
    .split(/[-T:.]/)
    .map((v, i) => (i < 3 ? parseInt(v, 10) : parseInt(v || "0", 10)));

  // Construct a Date in UTC by subtracting Malaysia offset
  const malaysiaOffsetMs = 8 * 60 * 60 * 1000;
  const utcDate = Date.UTC(year, month - 1, day, hour, minute, second);
  const raceStartTimeMs = utcDate - malaysiaOffsetMs;

  const config = {
    name: raw.name,
    location: raw.location || "",
    date: raw.date || "",
    description: raw.description || "",
    raceStartTimeMs,
  };

  writeFileSync(`${outDir}/config.json`, JSON.stringify(config));
  console.log(
    `Race start (Malaysia local gun time): ${new Date(raceStartTimeMs).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}`
  );
}
