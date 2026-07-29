// Fetch + validate public/constellation-boundaries.json.
// See README.md § Chart-mode layer.

import type {
  BoundaryArtifact,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import {
  FADE_END_MISPLACED_PCT,
  FADE_START_MISPLACED_PCT,
} from './boundary-layer-pure';

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
  const fade = artifact.fade;
  if (!Array.isArray(fade?.magLimits) || fade.magLimits.length === 0) {
    throw new Error('constellation-boundaries.json: fade table has no magnitude rows');
  }
  if (fade.offsetsPc.length !== fade.magLimits.length) {
    throw new Error(
      `constellation-boundaries.json: fade table has ${fade.magLimits.length} magnitude rows `
      + `but ${fade.offsetsPc.length} offset rows`,
    );
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

/** Fetch + validate the boundary artifact. Resolves null when the asset is
 *  absent (a checkout that never ran `build:catalog`) — the layer is
 *  optional and the chart renders without it. */
export async function loadBoundaries(url: string): Promise<BoundaryArtifact | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return validateBoundaryArtifact(await res.json());
}
