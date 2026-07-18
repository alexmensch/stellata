// Always-on planet-name SVG labels for the focused host's PlanetSystem.
// Hidden in chart mode and during warp.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { setStyle } from '../overlays/dirty-attr';

// Pixel offset from the projected planet centre to the label baseline,
// applied as both the x and y component (so the diagonal magnitude is
// LABEL_OFFSET_PX·√2 ≈ 14 px). Lets the label ride outside the body's
// quad-oversize halo at typical close-zoom framings without overlapping
// the body itself. Heliopause uses the same constant as a unit-vector
// magnitude so the two label families read at a similar visual gap from
// their referents.
export const LABEL_OFFSET_PX = 10;

interface Entry {
  el: SVGTextElement;
  name: string;
}

export function createPlanetLabels(stellata: Stellata): void {
  const group = document.getElementById('planet-labels') as unknown as SVGGElement | null;
  if (!group) return;

  const entries: Entry[] = [];
  const tmp = new THREE.Vector3();

  function clearEntries(): void {
    for (const e of entries) e.el.remove();
    entries.length = 0;
  }

  function rebuildEntries(): void {
    clearEntries();
    const ps = stellata.getFocusedPlanetSystem();
    if (!ps) return;
    const NS = 'http://www.w3.org/2000/svg';
    for (const p of ps.planets) {
      const text = document.createElementNS(NS, 'text') as SVGTextElement;
      text.setAttribute('class', 'planet-label');
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('dominant-baseline', 'central');
      text.textContent = p.name;
      group!.appendChild(text);
      entries.push({ el: text, name: p.name });
    }
  }

  // Idempotent group-level visibility. Uses dirty-attr's setStyle with a
  // '\0' poison sentinel rather than a bespoke boolean closure variable,
  // so the first matching-state write always lands — the SVG container has
  // no inline `display: none` in index.html, so its effective initial
  // state is visible, and a boolean sentinel initialised to `false` would
  // silently no-op on the first `setGroupVisible(false)` call. Same shape
  // as the heliopause first-load fix (consistency-at-the-seam §3).
  let lastGroupDisplay = '\0';
  function setGroupVisible(on: boolean): void {
    lastGroupDisplay = setStyle(group!, 'display', on ? '' : 'none', lastGroupDisplay);
  }
  setGroupVisible(false);

  stellata.on('planetSystem', () => {
    rebuildEntries();
    if (entries.length === 0) setGroupVisible(false);
  });
  rebuildEntries();

  stellata.on('frame', () => {
    if (entries.length === 0) {
      setGroupVisible(false);
      return;
    }
    // Chart (mono) mode renders its own paper-aesthetic glyph layer
    // and shouldn't double up with these labels.
    if (stellata.getMonochrome()) {
      setGroupVisible(false);
      return;
    }
    // Detail cycle: planet labels are the 'all' (labels) tier.
    if (!stellata.detailPermits('planetLabels')) {
      setGroupVisible(false);
      return;
    }
    const positions = stellata.getFocusedPlanetLocalPositions();
    if (!positions || positions.length / 3 !== entries.length) {
      setGroupVisible(false);
      return;
    }

    const camera = stellata.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // The observe-anchor body is shader-hidden (uHideIdx); its label
    // must not float alone at the camera's own position.
    const ps = stellata.getFocusedPlanetSystem();
    const hiddenFlat = stellata.planetField.hiddenInstance();
    const hiddenHost = hiddenFlat >= 0 ? stellata.planetField.hostPlanetOf(hiddenFlat) : null;
    const hiddenPlanetIdx =
      hiddenHost && ps && hiddenHost.hostStarIdx === ps.hostStarIdx
        ? hiddenHost.planetIdx
        : -1;

    setGroupVisible(true);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (i === hiddenPlanetIdx) {
        e.el.style.display = 'none';
        continue;
      }
      // Sync label visibility with the planet's orbit ring. A ring
      // suppressed by the pixel-gap heuristic at far framings means
      // its body is floor-clamped sub-pixel anyway; a floating label
      // attached to nothing visible reads as noise. Bodies still
      // render (the floor keeps them visible) — only labels track the
      // ring's "is this planet meaningfully resolvable?" answer.
      if (!stellata.isOrbitRingVisible(i)) {
        e.el.style.display = 'none';
        continue;
      }
      // A fully eclipsed body (behind the host's physical disc) renders
      // nothing — its label must not float alone on the host's disc.
      const flat = ps ? stellata.planetField.instanceIndexOf(ps.hostStarIdx, i) : null;
      if (flat !== null && stellata.planetField.eclipseDimForInstance(flat) <= 0) {
        e.el.style.display = 'none';
        continue;
      }
      tmp.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      tmp.applyMatrix4(camera.matrixWorldInverse);
      // Behind-or-at-near-plane points have no meaningful screen
      // projection; hide the label rather than smearing it across the
      // viewport edge from the divide-by-near-zero artefact.
      if (tmp.z >= -camera.near) {
        e.el.style.display = 'none';
        continue;
      }
      tmp.applyMatrix4(camera.projectionMatrix);
      const sx = (tmp.x + 1) * 0.5 * w;
      const sy = (1 - tmp.y) * 0.5 * h;
      e.el.style.display = '';
      e.el.setAttribute('x', (sx + LABEL_OFFSET_PX).toFixed(1));
      e.el.setAttribute('y', (sy + LABEL_OFFSET_PX).toFixed(1));
    }
  });
}
