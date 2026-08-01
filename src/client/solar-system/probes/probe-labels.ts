// Probe-name SVG labels, one per drawn marker. See README.md § Labels.

import * as THREE from 'three';
import type { KindContext } from '../../kinds/kind-module';
import { setStyle } from '../../overlays/dirty-attr';
import { placeAnchoredLabel } from '../../overlays/anchored-label';
import { LABEL_OFFSET_PX } from '../planets/planet-labels';
import type { ProbeField } from './probe-field';
import { probeLabelText } from './probe-trajectory';

/** Returns the teardown — the module holds it and runs it from the
 *  probe scene layer's dispose. */
export function createProbeLabels(ctx: KindContext, field: ProbeField): () => void {
  const group = document.getElementById('probe-labels') as unknown as SVGGElement | null;
  if (!group) return () => {};

  const entries: SVGTextElement[] = [];
  const tmp = new THREE.Vector3();

  function rebuildEntries(): void {
    for (const el of entries) el.remove();
    entries.length = 0;
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < field.probeCount(); i++) {
      const text = document.createElementNS(NS, 'text') as SVGTextElement;
      text.setAttribute('class', 'probe-label');
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('dominant-baseline', 'central');
      group!.appendChild(text);
      entries.push(text);
    }
  }

  // Poison sentinel so the first matching-state write still lands — the
  // container carries no inline display in index.html, so a boolean
  // initialised to `false` would no-op the first hide (same shape as the
  // planet-label group gate).
  let lastGroupDisplay = '\0';
  function setGroupVisible(on: boolean): void {
    lastGroupDisplay = setStyle(group!, 'display', on ? '' : 'none', lastGroupDisplay);
  }
  setGroupVisible(false);

  const unsubscribe = ctx.onFrame(() => {
    if (entries.length !== field.probeCount()) rebuildEntries();
    if (entries.length === 0 || ctx.getMonochrome()
        || !ctx.detailPermits('probeLabels')) {
      setGroupVisible(false);
      return;
    }
    const camera = ctx.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    setGroupVisible(true);
    for (let i = 0; i < entries.length; i++) {
      const el = entries[i];
      // Always-on while the marker is drawn: a probe is a discovery
      // affordance and its glyph carries no name of its own, so there is
      // no resolvability gate beyond the marker's own visibility.
      const sample = field.sampleFor(i);
      const traj = field.probeAt(i);
      if (sample === null || !sample.visible || traj === null) {
        el.style.display = 'none';
        continue;
      }
      tmp.copy(sample.localPc);
      const label = probeLabelText(traj, ctx.getT());
      if (el.textContent !== label) el.textContent = label;
      placeAnchoredLabel(el, tmp, camera, w, h, LABEL_OFFSET_PX);
    }
  });

  return () => {
    unsubscribe();
    for (const el of entries) el.remove();
    entries.length = 0;
    setGroupVisible(false);
  };
}
