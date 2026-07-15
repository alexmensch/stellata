// The card rolodex — the tier-2 object-info surface: focus card + per-POI
// cards as one stack with a single visible front card, the rest shown as
// promotable header strips. See ./README.md.

import type { Stellata } from '../stellata';
import { bindCollapse } from '../ui/panel-layout';
import { createCardBody } from './card-body';
import type { FocusCardContent, FocusCardProviders } from './focus-card-types';
import {
  FOCUS_KEY,
  planRolodex,
  poiIdxOf,
  poiKey,
  stripHeightPx,
  type CardKey,
} from './card-rolodex-pure';

const COLLAPSED_KEY = 'stellata.focus-card-collapsed';

export interface CardRolodexConfig {
  stellata: Stellata;
  providers: FocusCardProviders;
}

export function createCardRolodex(config: CardRolodexConfig): () => void {
  const { stellata, providers } = config;
  const stack = document.getElementById('card-stack')!;
  const stripsEl = document.getElementById('card-strips')!;
  const front = document.getElementById('front-card')!;
  const title = document.getElementById('front-card-title')!;
  const header = document.getElementById('front-card-header')!;
  const close = document.getElementById('front-card-close') as HTMLButtonElement;

  let desiredFront: CardKey | null = null;
  let frontKey: CardKey | null = null;
  let knownPois: readonly number[] = stellata.getPois();

  bindCollapse({
    container: stack,
    header,
    toggle: document.getElementById('front-card-toggle') as HTMLButtonElement,
    storageKey: COLLAPSED_KEY,
    ariaSubject: 'object info',
  });

  const body = createCardBody({
    card: stack,
    title,
    inner: document.getElementById('front-card-inner')!,
  });

  // Star and cloud focus are mutually exclusive; recompute from current
  // state on any input event rather than tracking event payloads.
  const focusContent = (): FocusCardContent | null => {
    const starIdx = stellata.getFocusedStar();
    if (starIdx !== null) return providers.star.format(starIdx);
    const cloudIdx = stellata.getFocusedCloud();
    if (cloudIdx !== null) return providers.cloud.format(cloudIdx);
    return null;
  };

  const dismiss = (key: CardKey) => {
    if (key === FOCUS_KEY) stellata.unfocus();
    else stellata.togglePoi(poiIdxOf(key)!);
  };

  const buildStrip = (key: CardKey, name: string): HTMLElement => {
    const strip = document.createElement('div');
    strip.className = 'card-strip';
    strip.classList.toggle('is-focus', key === FOCUS_KEY);
    const x = document.createElement('button');
    x.className = 'panel-close strip-close';
    x.type = 'button';
    x.setAttribute('aria-label', key === FOCUS_KEY ? 'Unfocus' : 'Unpin');
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss(key);
    });
    const label = document.createElement('span');
    label.className = 'card-title';
    label.textContent = name;
    strip.append(x, label);
    strip.addEventListener('click', () => {
      desiredFront = key;
      reconcile();
    });
    return strip;
  };

  const reconcile = () => {
    const focus = stellata.getCameraMode() === 'observe' ? null : focusContent();
    const plan = planRolodex({
      pois: stellata.getPois(),
      focusedStar: stellata.getFocusedStar(),
      focusVisible: focus !== null,
      desiredFront,
    });
    if (plan.front === null) {
      frontKey = null;
      stack.hidden = true;
      body.clear();
      stripsEl.textContent = '';
      return;
    }
    const contentFor = (key: CardKey): FocusCardContent =>
      key === FOCUS_KEY ? focus! : providers.star.format(poiIdxOf(key)!);
    // Minimized shows the focused object regardless of which card is
    // fronted for the expanded body; the × still dismisses whatever's
    // on display, so it tracks the same key.
    const collapsed = stack.classList.contains('collapsed');
    const displayKey = collapsed ? plan.minimizedFront! : plan.front;
    frontKey = displayKey;
    stack.hidden = false;
    front.classList.toggle('is-focus', displayKey === FOCUS_KEY);
    close.setAttribute('aria-label', displayKey === FOCUS_KEY ? 'Unfocus' : 'Unpin');
    const frontContent = contentFor(plan.front);
    body.render(frontContent);
    const displayName =
      displayKey === plan.front ? frontContent.name : contentFor(displayKey).name;
    title.textContent =
      collapsed && plan.strips.length > 0
        ? `${displayName} · ${plan.strips.length} POI`
        : displayName;
    stripsEl.textContent = '';
    stripsEl.style.setProperty('--strip-h', `${stripHeightPx(plan.strips.length)}px`);
    for (const key of plan.strips) {
      stripsEl.appendChild(buildStrip(key, contentFor(key).name));
    }
  };

  const onClose = (e: MouseEvent) => {
    e.stopPropagation();
    if (frontKey !== null) dismiss(frontKey);
  };
  close.addEventListener('click', onClose);
  // bindCollapse's own listener (registered above) toggles the
  // `.collapsed` class first; this one runs after and re-derives the
  // minimized display from the new state.
  header.addEventListener('click', reconcile);

  const unsubs = [
    stellata.on('focus', () => {
      desiredFront = stellata.getFocusedStar() !== null ? FOCUS_KEY : null;
      reconcile();
    }),
    stellata.on('cloudFocus', () => {
      desiredFront = stellata.getFocusedCloud() !== null ? FOCUS_KEY : null;
      reconcile();
    }),
    stellata.on('cameraMode', reconcile),
    stellata.on('pois', (pois) => {
      const prev = new Set(knownPois);
      const added = pois.filter((idx) => !prev.has(idx));
      knownPois = [...pois];
      if (added.length > 0) desiredFront = poiKey(added[added.length - 1]);
      reconcile();
    }),
    stellata.on('frame', () => body.tick()),
  ];
  reconcile();

  return () => {
    for (const u of unsubs) u();
    close.removeEventListener('click', onClose);
    header.removeEventListener('click', reconcile);
    stack.hidden = true;
    body.clear();
    stripsEl.textContent = '';
  };
}
