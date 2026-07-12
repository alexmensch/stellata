// Per-POI info cards stacked above the focus card — one focus-card-layout
// card per pinned star, newest on top. See ./README.md § POI cards.

import type { Stellata } from '../stellata';
import { createCardBody, type CardBody } from '../focus-card/card-body';
import type { FocusCardProvider } from '../focus-card/focus-card-types';
import { bindCollapse } from '../ui/panel-layout';
import { planStack } from './poi-card-stack-pure';

export interface PoiCardStackConfig {
  stellata: Stellata;
  starProvider: FocusCardProvider<'star'>;
}

interface PoiCard {
  el: HTMLElement;
  body: CardBody;
}

export function createPoiCardStack(config: PoiCardStackConfig): () => void {
  const { stellata, starProvider } = config;
  const container = document.getElementById('poi-cards')!;
  const cards = new Map<number, PoiCard>();
  let rendered: readonly number[] = [];

  const buildCard = (idx: number): PoiCard => {
    const el = document.createElement('aside');
    el.className = 'panel focus-card';
    const header = document.createElement('div');
    header.className = 'panel-header';
    const close = document.createElement('button');
    close.className = 'panel-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Unpin');
    close.textContent = '×';
    const title = document.createElement('span');
    title.className = 'card-title';
    const toggle = document.createElement('button');
    toggle.className = 'panel-toggle';
    toggle.type = 'button';
    header.append(close, title, toggle);
    const inner = document.createElement('div');
    inner.className = 'panel-inner focus-card-inner';
    el.append(header, inner);

    bindCollapse({
      container: el,
      header,
      toggle,
      initialCollapsed: true,
      ariaSubject: 'pinned-object info',
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      stellata.togglePoi(idx);
    });

    const body = createCardBody({ card: el, title, inner });
    body.render(starProvider.format(idx));
    return { el, body };
  };

  const applyFocusSuppression = () => {
    const focused = stellata.getFocusedStar();
    for (const [idx, card] of cards) card.el.hidden = idx === focused;
  };

  const reconcile = () => {
    const pois = stellata.getPois();
    const plan = planStack(rendered, pois);
    rendered = [...pois];
    for (const idx of plan.removed) {
      cards.get(idx)!.el.remove();
      cards.delete(idx);
    }
    for (const idx of plan.added) cards.set(idx, buildCard(idx));
    // Appending in display order moves already-attached cards into place.
    for (const idx of plan.order) container.appendChild(cards.get(idx)!.el);
    applyFocusSuppression();
  };

  const unsubs = [
    stellata.on('pois', reconcile),
    stellata.on('focus', applyFocusSuppression),
    stellata.on('frame', () => {
      for (const card of cards.values()) card.body.tick();
    }),
  ];
  reconcile();

  return () => {
    for (const u of unsubs) u();
    for (const card of cards.values()) card.el.remove();
    cards.clear();
  };
}
