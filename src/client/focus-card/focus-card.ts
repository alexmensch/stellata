// The tier-2 focus card — a persistent, collapsible panel for the
// focused object, docked at the bottom of the right-side control stack.
// See ./README.md.

import type { Stellata } from '../stellata';
import { bindCollapse } from '../ui/panel-layout';
import type { FocusCardContent, FocusCardProviders } from './focus-card-types';

const COLLAPSED_KEY = 'stellata.focus-card-collapsed';

export interface FocusCardConfig {
  stellata: Stellata;
  providers: FocusCardProviders;
}

interface LiveRow {
  el: HTMLElement;
  value: () => string;
  last: string;
}

export function createFocusCard(config: FocusCardConfig): () => void {
  const { stellata, providers } = config;
  const card = document.getElementById('focus-card')!;
  const title = document.getElementById('focus-card-title')!;
  const inner = document.getElementById('focus-card-inner')!;

  bindCollapse({
    container: card,
    header: document.getElementById('focus-card-header')!,
    toggle: document.getElementById('focus-card-toggle') as HTMLButtonElement,
    storageKey: COLLAPSED_KEY,
    ariaSubject: 'object info',
  });

  let liveRows: LiveRow[] = [];

  const render = (content: FocusCardContent) => {
    title.textContent = content.name;
    inner.textContent = '';
    liveRows = [];
    for (const line of content.identityLines) {
      const el = document.createElement('div');
      el.className = 'focus-identity';
      el.textContent = line;
      inner.appendChild(el);
    }
    const bindValue = (el: HTMLElement, value: string | (() => string)) => {
      if (typeof value === 'function') {
        const text = value();
        el.textContent = text;
        liveRows.push({ el, value, last: text });
      } else {
        el.textContent = value;
      }
    };
    for (const row of content.rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'focus-row';
      const label = document.createElement('span');
      label.className = 'focus-row-label';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = 'focus-row-value';
      rowEl.append(label, value);
      inner.appendChild(rowEl);
      bindValue(value, row.value);
    }
    for (const line of content.lines) {
      const el = document.createElement('div');
      el.className = 'focus-line';
      inner.appendChild(el);
      bindValue(el, line);
    }
    card.hidden = false;
  };

  const hide = () => {
    card.hidden = true;
    liveRows = [];
  };

  // Star and cloud focus are mutually exclusive; recompute from current
  // state on any of the three inputs rather than tracking event payloads.
  const recompute = () => {
    if (stellata.getCameraMode() === 'observe') return hide();
    const starIdx = stellata.getFocusedStar();
    if (starIdx !== null) return render(providers.star.format(starIdx));
    const cloudIdx = stellata.getFocusedCloud();
    if (cloudIdx !== null) return render(providers.cloud.format(cloudIdx));
    hide();
  };

  const tick = () => {
    if (card.hidden || card.classList.contains('collapsed')) return;
    for (const row of liveRows) {
      const text = row.value();
      if (text !== row.last) {
        row.last = text;
        row.el.textContent = text;
      }
    }
  };

  const unsubs = [
    stellata.on('focus', recompute),
    stellata.on('cloudFocus', recompute),
    stellata.on('cameraMode', recompute),
    stellata.on('frame', tick),
  ];
  recompute();

  return () => {
    for (const u of unsubs) u();
    hide();
  };
}
