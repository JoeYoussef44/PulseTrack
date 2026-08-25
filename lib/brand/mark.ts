/**
 * The PulseTrack mark, as geometry rather than as a drawing.
 *
 * One pulse trace, used at three sizes and in two places that cannot import
 * each other: the React component in `components/brand/mark.tsx` and the
 * favicon written by `scripts/build-icons.ts`. Drawing it out separately in a
 * `.tsx` and an `.svg` is precisely how the FHIR loading skeleton drifted from
 * its own page (PR #27) — so the shape is defined here, exactly once, and both
 * sides import it.
 *
 * The trace is deliberately short on vertices. A favicon is read at 16px, and
 * every extra inflection there turns into mud.
 */

/** A 32-unit square, so the values below read as pixels at the favicon size. */
export const MARK_VIEWBOX = "0 0 32 32";
export const MARK_SIZE = 32;

/** Corner radius of the filled tile. Tile form is used by the favicon only. */
export const MARK_TILE_RADIUS = 7.5;

/**
 * Flat, up to the peak, down through the trough, flat again — baseline at 19.
 * It starts and ends 4.5 units from the edge, which with a round cap on a
 * 3-unit stroke leaves exactly 3 units of clear space.
 */
export const MARK_PATH = "M4.5 19H10L13.5 10L18 24L21 19H27.5";
export const MARK_STROKE_WIDTH = 3;

/**
 * `--color-accent` and white, repeated as literals because an SVG file on disk
 * cannot read a CSS custom property. If the accent ever moves in `globals.css`
 * this has to move with it — hence the note, and hence a single line to change.
 */
export const MARK_TILE_FILL = "#0a5a6b";
export const MARK_TILE_STROKE = "#ffffff";
