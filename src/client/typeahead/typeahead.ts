// Generic typeahead dropdown (DOM glue; pure helpers in `typeahead-util.ts`).
// See src/client/typeahead/README.md.

import { applyHoverClass } from './typeahead-util';
import { escapeHtml } from '../ui/dom-util';

export interface TypeaheadRow {
  /** Primary line text. */
  primary: string;
  /** Secondary line text, rendered with the `.sub` class. */
  sub: string;
}

export interface TypeaheadOptions<T> {
  input: HTMLInputElement;
  resultsEl: HTMLUListElement;
  /** Compute the visible rows for a query. Called on focus, on every
   * input event, and on programmatic re-renders. The query is the raw
   * input value — implementations are free to trim or normalise. */
  runQuery: (query: string) => T[];
  /** Convert an item to its primary/sub display strings. */
  rowFor: (item: T) => TypeaheadRow;
  onSelect: (item: T) => void;
  /** Called when the optional `clearBtn` is clicked. */
  onClear?: () => void;
  /** Optional clear button. Hidden whenever the displayName is empty
   * and shown otherwise. Wired with `onClear`. */
  clearBtn?: HTMLButtonElement;
  /** Optional hook fired after every successful render. Used by
   * floating dropdowns that anchor to a moving DOM row. */
  positionResults?: () => void;
  /** Optional ownership coordinator across multiple Typeaheads sharing
   * a single resultsEl (e.g. the focus + to inputs in the search
   * panel). When provided, blur only hides the dropdown if no other
   * Typeahead in the group has claimed focus. */
  group?: TypeaheadGroup;
  /** Trailing debounce on keystroke-driven queries, ms. 0 (default)
   * queries synchronously on every input event. Set for expensive
   * runQuery implementations (the fuzzy star corpus); keystrokes then
   * only pay the query cost after a typing pause. Enter flushes a
   * pending query so fast-type-then-enter still selects against the
   * full typed text. */
  debounceMs?: number;
}

/**
 * Coordinates which Typeahead currently owns a shared resultsEl.
 * Identity-only — the group never reads the active typeahead's `T`.
 */
export class TypeaheadGroup {
  active: object | null = null;
}

export class Typeahead<T> {
  private readonly group: TypeaheadGroup;
  private displayName = '';
  private results: T[] = [];
  private hoverIdx = -1;
  private pendingQuery: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TypeaheadOptions<T>) {
    this.group = opts.group ?? new TypeaheadGroup();

    const { input, resultsEl, clearBtn, onClear, debounceMs = 0 } = opts;

    input.addEventListener('input', () => {
      if (debounceMs <= 0) {
        this.render(input.value);
        return;
      }
      this.cancelPendingQuery();
      this.pendingQuery = setTimeout(() => {
        this.pendingQuery = null;
        this.render(input.value);
      }, debounceMs);
    });
    input.addEventListener('focus', () => {
      this.group.active = this;
      this.render(input.value);
    });
    // Defer hide so a row mousedown wins the race against the input's
    // blur. 140 ms matches both prior implementations. A pending
    // debounced query is cancelled — firing after blur would re-show
    // the dropdown under nobody's focus.
    input.addEventListener('blur', () => {
      this.cancelPendingQuery();
      setTimeout(() => {
        if (this.group.active === this) {
          resultsEl.hidden = true;
          this.group.active = null;
        }
        this.restore();
      }, 140);
    });
    input.addEventListener('keydown', (e) => this.handleKey(e));

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        // Clear input.value before refocus. setName('') in the onClear
        // chain leaves it alone while group.active === this (the X
        // mousedown's 140 ms blur-hide defer is still pending), and the
        // synthetic focus() below would then re-render the dropdown
        // against the orphaned prior query. Reproduces inside the
        // relocated Go modal: X-clear left the focus dropdown visible
        // after the modal closed.
        input.value = '';
        onClear?.();
        input.focus();
      });
    }
  }

  /**
   * Update the displayed name (e.g. after a URL-restore or external
   * navigation changes the focused entity). When this typeahead is
   * not currently focused, the new name is also written into the
   * `<input>`; when it is focused, the user's in-progress typing is
   * preserved and the displayName is restored on blur instead.
   */
  setName(name: string): void {
    this.displayName = name;
    if (this.group.active !== this) {
      this.opts.input.value = name;
    }
    if (this.opts.clearBtn) this.opts.clearBtn.hidden = !name;
  }

  private restore(): void {
    this.opts.input.value = this.displayName;
  }

  private render(query: string): void {
    this.results = this.opts.runQuery(query);
    // Rebuild rows with no active class, then route the initial hover
    // through setHover so applyHoverClass owns the scroll-into-view
    // path for both rebuild and arrow-nav. Pre-baking the class here
    // would skip the scroll path and silently break the moment a
    // rebuild preserves resultsEl.scrollTop.
    this.hoverIdx = -1;
    this.renderResultsDom();
    if (this.results.length > 0) this.setHover(0);
    this.opts.resultsEl.hidden = this.results.length === 0;
    this.opts.positionResults?.();
  }

  private renderResultsDom(): void {
    const { resultsEl } = this.opts;
    resultsEl.innerHTML = '';
    for (let i = 0; i < this.results.length; i++) {
      const row = this.opts.rowFor(this.results[i]);
      const li = document.createElement('li');
      li.className = '';
      li.innerHTML = `<span>${escapeHtml(row.primary)}</span><span class="sub">${escapeHtml(row.sub)}</span>`;
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.pick(i);
      });
      resultsEl.appendChild(li);
    }
  }

  private setHover(newIdx: number): void {
    applyHoverClass(this.opts.resultsEl, this.hoverIdx, newIdx);
    this.hoverIdx = newIdx;
  }

  private pick(i: number): void {
    const item = this.results[i];
    if (!item) return;
    this.opts.onSelect(item);
    this.opts.resultsEl.hidden = true;
    this.opts.input.blur();
  }

  private cancelPendingQuery(): void {
    if (this.pendingQuery !== null) {
      clearTimeout(this.pendingQuery);
      this.pendingQuery = null;
    }
  }

  /** Run a debounce-deferred query NOW so the key about to be handled
   *  acts on results for the full typed text. */
  private flushPendingQuery(): void {
    if (this.pendingQuery === null) return;
    this.cancelPendingQuery();
    this.render(this.opts.input.value);
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') this.flushPendingQuery();
    if (this.results.length === 0) return;
    if (e.key === 'ArrowDown') {
      this.setHover((this.hoverIdx + 1) % this.results.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      this.setHover((this.hoverIdx - 1 + this.results.length) % this.results.length);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (this.hoverIdx >= 0) this.pick(this.hoverIdx);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      // Intentionally no preventDefault — let global Escape handlers
      // (modal close, mode toggle, etc.) still see the key.
      this.opts.resultsEl.hidden = true;
      this.opts.input.blur();
    }
  }
}
