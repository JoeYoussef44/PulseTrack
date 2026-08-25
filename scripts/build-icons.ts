/**
 * Writes `app/icon.svg` from the mark geometry in `lib/brand/mark.ts`.
 *
 *   npx tsx scripts/build-icons.ts
 *
 * The SVG is generated rather than hand-written so that the favicon and the
 * in-app mark cannot drift apart: both read the same constants.
 *
 * `app/favicon.ico` is rasterised *from this file* for the browsers that still
 * ask for `/favicon.ico` by name. That step needs a rasteriser, and the only
 * one on this machine is the headless Chrome used for QA — which lives in the
 * scratchpad and deliberately never enters `package.json` (D-QA-1). So the ICO
 * is committed as a binary, and regenerating it means re-running that
 * scratchpad step. Nothing here depends on it: this script alone keeps the
 * served SVG correct.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  MARK_PATH,
  MARK_SIZE,
  MARK_STROKE_WIDTH,
  MARK_TILE_FILL,
  MARK_TILE_RADIUS,
  MARK_TILE_STROKE,
  MARK_VIEWBOX,
} from "../lib/brand/mark";

/**
 * The tile form, not the bare one. A favicon has no surrounding text to take
 * its colour from, and browser chrome is light in one theme and dark in the
 * other — an unfilled stroke disappears into one of them.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${MARK_SIZE}" height="${MARK_SIZE}" role="img" aria-label="PulseTrack">
  <rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${MARK_TILE_RADIUS}" fill="${MARK_TILE_FILL}"/>
  <path d="${MARK_PATH}" fill="none" stroke="${MARK_TILE_STROKE}" stroke-width="${MARK_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const out = join(process.cwd(), "app", "icon.svg");
writeFileSync(out, svg, "utf8");
console.log(`wrote ${out} (${Buffer.byteLength(svg)} bytes)`);
