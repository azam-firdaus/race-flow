import { readFileSync, writeFileSync } from "fs";
import { DOMParser } from "@xmldom/xmldom";
import { gpx } from "@tmcw/togeojson";
import * as turf from "@turf/turf";

/** Reads <inDir>/route.gpx, writes <outDir>/route.json. Returns total distance in km. */
export function processRoute(inDir, outDir) {
  const gpxPath = `${inDir}/route.gpx`;
  const xml = new DOMParser().parseFromString(readFileSync(gpxPath, "utf8"), "text/xml");
  const geojson = gpx(xml);

  const line = geojson.features.find((f) => f.geometry?.type === "LineString");
  if (!line) {
    throw new Error(
      `${gpxPath}: no LineString track found. Make sure it has a <trk><trkseg> with trkpt entries.`
    );
  }

  const totalDistanceKm = turf.length(line, { units: "kilometers" });
  writeFileSync(`${outDir}/route.json`, JSON.stringify({ line, totalDistanceKm }));

  console.log(`Route: ${totalDistanceKm.toFixed(2)} km, ${line.geometry.coordinates.length} points`);
  return totalDistanceKm;
}
