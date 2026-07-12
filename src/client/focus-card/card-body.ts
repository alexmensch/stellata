// Shared card-content renderer behind the focus card and the POI cards:
// fills a card's title + body from FocusCardContent, tracks LIVE
// (function-valued) rows, and re-evaluates them on tick. See ./README.md.

import type { FocusCardContent } from './focus-card-types';

export interface CardBodyElements {
  /** Card root — tick() is a no-op while it is `hidden` or `.collapsed`. */
  card: HTMLElement;
  title: HTMLElement;
  inner: HTMLElement;
}

interface LiveRow {
  el: HTMLElement;
  value: () => string;
  last: string;
}

export interface CardBody {
  render(content: FocusCardContent): void;
  tick(): void;
  clear(): void;
}

export function createCardBody(els: CardBodyElements): CardBody {
  const { card, title, inner } = els;
  let liveRows: LiveRow[] = [];

  const bindValue = (el: HTMLElement, value: string | (() => string)) => {
    if (typeof value === 'function') {
      const text = value();
      el.textContent = text;
      liveRows.push({ el, value, last: text });
    } else {
      el.textContent = value;
    }
  };

  return {
    render(content: FocusCardContent) {
      title.textContent = content.name;
      inner.textContent = '';
      liveRows = [];
      for (const line of content.identityLines) {
        const el = document.createElement('div');
        el.className = 'focus-identity';
        el.textContent = line;
        inner.appendChild(el);
      }
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
    },
    tick() {
      if (card.hidden || card.classList.contains('collapsed')) return;
      for (const row of liveRows) {
        const text = row.value();
        if (text !== row.last) {
          row.last = text;
          row.el.textContent = text;
        }
      }
    },
    clear() {
      liveRows = [];
    },
  };
}
