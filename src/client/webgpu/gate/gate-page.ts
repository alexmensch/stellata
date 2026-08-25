// The "requires WebGPU" takeover, for a browser that cannot run the
// renderer. See README.md.

import { adviceFor, type GateVerdict, type UaHints } from './gate-advice-pure';

export const GATE_ELEMENT_ID = 'webgpu-gate';

/** The audit date the advice copy is good as of — the epic's support
 *  survey. Shown on the page, so a stale claim reads as dated rather than
 *  as a guarantee. */
export const SUPPORT_AUDIT_LABEL = 'August 2026';

/** Everything a boot may already have drawn. Hidden rather than removed:
 *  the gate is terminal for this page load, but an intact DOM keeps a
 *  console session able to inspect what booted. Every id here is pinned
 *  against `index.html` by the tests — a rename must not silently no-op. */
export const GATE_HIDES =
  'canvas, .overlay, #topbar, #panel, #loading, #ui-top-left, #meta, #tooltip';

function hintsFromNavigator(): UaHints {
  return {
    userAgent: navigator.userAgent,
    platform: (navigator as { platform?: string }).platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

/**
 * Replace the page with the gate. Idempotent, so a caller that races a
 * boot failure against an explicit force cannot stack two copies.
 */
export function showWebGpuGate(
  verdict: GateVerdict,
  hints: UaHints = hintsFromNavigator(),
  doc: Document = document,
): HTMLElement {
  const existing = doc.getElementById(GATE_ELEMENT_ID);
  if (existing !== null) return existing;

  const advice = adviceFor(hints, verdict);
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

  for (const el of doc.querySelectorAll<HTMLElement>(GATE_HIDES)) {
    el.style.display = 'none';
  }
  return gate;
}
