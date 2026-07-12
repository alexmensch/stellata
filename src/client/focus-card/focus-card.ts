// The tier-2 focus card — a persistent, collapsible panel for the
// focused object, docked at the bottom of the right-side control stack.
// See ./README.md.

import type { Stellata } from '../stellata';
import { bindCollapse } from '../ui/panel-layout';
import { createCardBody } from './card-body';
import type { FocusCardContent, FocusCardProviders } from './focus-card-types';

const COLLAPSED_KEY = 'stellata.focus-card-collapsed';

export interface FocusCardConfig {
  stellata: Stellata;
  providers: FocusCardProviders;
}

export function createFocusCard(config: FocusCardConfig): () => void {
  const { stellata, providers } = config;
  const card = document.getElementById('focus-card')!;
  const close = document.getElementById('focus-card-close') as HTMLButtonElement;

  bindCollapse({
    container: card,
    header: document.getElementById('focus-card-header')!,
    toggle: document.getElementById('focus-card-toggle') as HTMLButtonElement,
    storageKey: COLLAPSED_KEY,
    ariaSubject: 'object info',
  });

  const onClose = (e: MouseEvent) => {
    e.stopPropagation();
    stellata.unfocus();
  };
  close.addEventListener('click', onClose);

  const body = createCardBody({
    card,
    title: document.getElementById('focus-card-title')!,
    inner: document.getElementById('focus-card-inner')!,
  });

  const render = (content: FocusCardContent) => {
    body.render(content);
    card.hidden = false;
  };

  const hide = () => {
    card.hidden = true;
    body.clear();
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

  const unsubs = [
    stellata.on('focus', recompute),
    stellata.on('cloudFocus', recompute),
    stellata.on('cameraMode', recompute),
    stellata.on('frame', () => body.tick()),
  ];
  recompute();

  return () => {
    for (const u of unsubs) u();
    close.removeEventListener('click', onClose);
    hide();
  };
}
