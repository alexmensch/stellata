// Fetch + validate public/constellation-boundaries.json.
// See README.md § Chart-mode layer.

import {
  validateRegionGridWire,
  type BoundaryArtifact,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import {
  FADE_END_MISPLACED_PCT,
  FADE_START_MISPLACED_PCT,
} from './boundary-layer-pure';
import { FULL_SPHERE_SQUARE_DEG, IAU_REGION_COUNT } from './iau-geometry/iau-boundaries-pure';

/** Slack on the sphere-closure check. Each of the 89 areas is quantised to
 *  `AREA_DECIMALS = 2`, so the sum carries at most 89 × 0.005 of rounding. */
const AREA_CLOSURE_TOLERANCE_SQUARE_DEG = 1;

/**
 * Narrow a parsed wire object to `BoundaryArtifact`, throwing on anything the
 * layer would otherwise mis-draw in silence.
 *
 * `frame` is the load-bearing check: the arcs are *drawn* at equinox B1875
 * but the directions are *emitted* in ICRS, and B1875 directions rendered as
 * if they were ICRS resolve to a plausible-looking sky sitting ~1.4° off
 * every star (§ B1875).
 */
export function validateBoundaryArtifact(raw: unknown): BoundaryArtifact {
  const artifact = raw as BoundaryArtifact;
  if (artifact?.frame !== 'ICRS') {
    throw new Error(
      `constellation-boundaries.json: frame is ${String(artifact?.frame)}, expected ICRS`,
    );
  }
  if (!Array.isArray(artifact.segments) || artifact.segments.length === 0) {
    throw new Error('constellation-boundaries.json: no boundary segments');
  }
  // One label per region, not "at least one": a short list is a partial sky
  // whose missing names read as a declutter decision rather than a stale file.
  if (!Array.isArray(artifact.labels) || artifact.labels.length !== IAU_REGION_COUNT) {
    throw new Error(
      `constellation-boundaries.json: ${Array.isArray(artifact.labels) ? artifact.labels.length : 'no'} `
      + `label anchors for ${IAU_REGION_COUNT} regions`,
    );
  }
  let areaSquareDeg = 0;
  for (const label of artifact.labels) {
    if (!label.c || !Array.isArray(label.d) || label.d.length !== 3) {
      throw new Error(
        `constellation-boundaries.json: label ${String(label?.c)} carries no direction`,
      );
    }
    areaSquareDeg += label.a;
  }
  // The areas are what makes the label set externally checkable — they
  // reproduce the published IAU values, and the regions partition the sphere,
  // so they close on it. That closure is the reason they ship, so it is
  // asserted rather than assumed: a truncated or reordered region set arrives
  // with the right label count and the wrong sky.
  if (Math.abs(areaSquareDeg - FULL_SPHERE_SQUARE_DEG) > AREA_CLOSURE_TOLERANCE_SQUARE_DEG) {
    throw new Error(
      `constellation-boundaries.json: label areas sum to ${areaSquareDeg.toFixed(2)} `
      + `sq deg, expected the full sphere (${FULL_SPHERE_SQUARE_DEG.toFixed(2)})`,
    );
  }
  try {
    validateRegionGridWire(artifact.regions);
  } catch (err) {
    throw new Error(`constellation-boundaries.json: ${(err as Error).message}`);
  }
  const fade = artifact.fade;
  if (!Array.isArray(fade?.magLimits) || fade.magLimits.length === 0) {
    throw new Error('constellation-boundaries.json: fade table has no magnitude rows');
  }
  // resolveBoundaryFadeWindowPc brackets a magnitude against this column by
  // walking it forwards; out of order it silently returns the wrong window.
  for (let i = 1; i < fade.magLimits.length; i++) {
    if (fade.magLimits[i] <= fade.magLimits[i - 1]) {
      throw new Error(
        `constellation-boundaries.json: fade magLimits must ascend (row ${i} is `
        + `${fade.magLimits[i]} after ${fade.magLimits[i - 1]})`,
      );
    }
  }
  if (!Array.isArray(fade.quantilePcts) || fade.quantilePcts.length === 0) {
    throw new Error('constellation-boundaries.json: fade table has no quantile columns');
  }
  if (!Array.isArray(fade.offsetsPc) || fade.offsetsPc.length !== fade.magLimits.length) {
    throw new Error(
      `constellation-boundaries.json: fade table has ${fade.magLimits.length} magnitude rows `
      + `but ${Array.isArray(fade.offsetsPc) ? fade.offsetsPc.length : 'no'} offset rows`,
    );
  }
  // A row narrower than the column header resolves a quantile to undefined,
  // which carries NaN all the way to the fade factor and stops the layer ever
  // hiding itself — the silent mis-draw this whole function exists to catch.
  for (let i = 0; i < fade.offsetsPc.length; i++) {
    const row = fade.offsetsPc[i];
    if (!Array.isArray(row) || row.length !== fade.quantilePcts.length) {
      throw new Error(
        `constellation-boundaries.json: fade row ${i} carries `
        + `${Array.isArray(row) ? row.length : 'no'} offsets for `
        + `${fade.quantilePcts.length} quantile columns`,
      );
    }
  }
  for (const pct of [FADE_START_MISPLACED_PCT, FADE_END_MISPLACED_PCT]) {
    if (!fade.quantilePcts.includes(pct)) {
      throw new Error(
        `constellation-boundaries.json: fade table carries no ${pct}% quantile `
        + `(has ${fade.quantilePcts.join(', ')})`,
      );
    }
  }
  return artifact;
}

/**
 * Fetch + validate the boundary artifact, or null for no layer at all — the
 * chart renders without it.
 *
 * **Nothing here may reject.** `main.ts` loads this inside a `Promise.all`
 * alongside the catalog, so a rejection takes the whole app's boot with it,
 * which is never the proportionate answer for an optional layer. Absence
 * can't be detected by status alone either: `not_found_handling =
 * "single-page-application"` (`wrangler.toml`) answers a missing asset with
 * index.html at 200, so a deployed build that never ran `build:catalog`
 * arrives here as a JSON parse error rather than a 404.
 */
export async function loadBoundaries(url: string): Promise<BoundaryArtifact | null> {
  let raw: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }
  try {
    return validateBoundaryArtifact(raw);
  } catch (err) {
    // Present but wrong shape: warn and draw nothing, the contract
    // local-group-loader uses for a stale artifact. Dropping the layer still
    // honours the frame check — a B1875-framed artifact never reaches the GPU.
    console.warn(`${(err as Error).message} — rebuild with \`pnpm run build:catalog\``);
    return null;
  }
}
