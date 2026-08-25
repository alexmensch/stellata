// The "requires WebGPU" takeover, for a browser that cannot run the
// renderer. See README.md.

import { adviceFor, type UaHints } from './gate-advice-pure';
import type { WebGpuVerdict } from './webgpu-support';

export const GATE_ELEMENT_ID = 'webgpu-gate';

/** The audit date the advice copy is good as of — the epic's support
 *  survey. Shown on the page, so a stale claim reads as dated rather than
 *  as a guarantee. */
export const SUPPORT_AUDIT_LABEL = 'August 2026';

function hintsFromNavigator(): UaHints {
  return {
    userAgent: navigator.userAgent,
    platform: (navigator as { platform?: string }).platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

/**
 * Replace the page with the gate.
 *
 * Idempotent: a second call with the gate already up is a no-op, so a
 * caller that races (boot failure plus an explicit force) cannot stack two
 * copies. Returns the element either way, which is what the tests assert
 * against.
 *
 * The canvas and every UI chrome element are hidden rather than removed —
 * the gate is terminal for this page load, but leaving the DOM intact
 * keeps a console session able to inspect what booted.
 */
export function showWebGpuGate(
  verdict: Exclude<WebGpuVerdict, 'supported'>,
  hints: UaHints = hintsFromNavigator(),
  doc: Document = document,
): HTMLElement {
  const existing = doc.getElementById(GATE_ELEMENT_ID);
  if (existing !== null) return existing;

  const advice = adviceFor(hints);
  const gate = doc.createElement('div');
  gate.id = GATE_ELEMENT_ID;
  gate.className = 'webgpu-gate';
  gate.dataset.platform = advice.platform;
  gate.dataset.verdict = verdict;
  gate.setAttribute('role', 'alertdialog');
  gate.setAttribute('aria-labelledby', 'webgpu-gate-title');

  const inner = doc.createElement('div');
  inner.className = 'webgpu-gate-inner';

  const label = doc.createElement('div');
  label.className = 'webgpu-gate-label';
  label.textContent = 'Stellata';

  const title = doc.createElement('h1');
  title.id = 'webgpu-gate-title';
  title.className = 'webgpu-gate-title';
  title.textContent = 'This browser can’t run Stellata yet';

  const lead = doc.createElement('p');
  lead.className = 'webgpu-gate-lead';
  lead.textContent = verdict === 'no-api'
    ? 'Stellata renders 313,000 stars with WebGPU, a graphics standard this '
      + 'browser doesn’t support.'
    : 'Stellata renders 313,000 stars with WebGPU. This browser supports it, but '
      + 'couldn’t start a graphics device — often a driver the browser '
      + 'blocks, or a setting left switched off.';

  const action = doc.createElement('p');
  action.className = 'webgpu-gate-action';
  action.textContent = advice.action;

  const detail = doc.createElement('p');
  detail.className = 'webgpu-gate-detail';
  detail.textContent = advice.detail;

  const dated = doc.createElement('p');
  dated.className = 'webgpu-gate-dated';
  dated.textContent =
    `Browser support checked ${SUPPORT_AUDIT_LABEL}; yours may have added it since.`;

  inner.append(label, title, lead, action, detail, dated);
  gate.append(inner);
  doc.body.append(gate);

  // Terminal for this page load: nothing behind the gate is reachable, and
  // a half-built scene under it would keep animating.
  for (const el of doc.querySelectorAll<HTMLElement>('canvas, .overlay, #topbar, #panel')) {
    el.style.display = 'none';
  }
  return gate;
}
