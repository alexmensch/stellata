import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Typeahead, TypeaheadGroup, type TypeaheadOptions } from './typeahead';
import { TYPEAHEAD_ACTIVE_CLASS } from './typeahead-util';

// Element-shaped stubs — the suite runs in vitest's 'node' environment
// (see typeahead-util.test.ts). `focus()` / `blur()` dispatch their own
// events, which is what the class listens for; a real DOM only fires
// those for elements attached to a document.
class ElStub extends EventTarget {
  hidden = false;
  className = '';
  innerHTML = '';
  readonly children: ElStub[] = [];
  readonly classes = new Set<string>();
  readonly classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
  };
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  offsetTop = 0;
  offsetHeight = 0;
  appendChild(child: ElStub) {
    this.children.push(child);
    return child;
  }
}

class InputStub extends ElStub {
  value = '';
  focused = false;
  focus() {
    this.focused = true;
    this.dispatchEvent(new Event('focus'));
  }
  blur() {
    this.focused = false;
    this.dispatchEvent(new Event('blur'));
  }
  type(text: string) {
    this.value = text;
    this.dispatchEvent(new Event('input'));
  }
  // Node has no KeyboardEvent global; the handler only reads `key` and
  // calls preventDefault.
  keydown(key: string): Event {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key });
    this.dispatchEvent(e);
    return e;
  }
}

// The class rebuilds rows through document.createElement.
const documentStub = { createElement: () => new ElStub() };

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { document?: unknown }).document = documentStub;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { document?: unknown }).document;
});

const CORPUS = ['Vega', 'Sirius', 'Rigel'];

type Harness = {
  input: InputStub;
  resultsEl: ElStub;
  clearBtn: ElStub;
  typeahead: Typeahead<string>;
  selected: string[];
  clearedValues: string[];
  queries: string[];
};

function makeTypeahead(overrides: Partial<TypeaheadOptions<string>> = {}): Harness {
  const input = new InputStub();
  const resultsEl = new ElStub();
  const clearBtn = new ElStub();
  const selected: string[] = [];
  const clearedValues: string[] = [];
  const queries: string[] = [];
  const typeahead = new Typeahead<string>({
    input: input as unknown as HTMLInputElement,
    resultsEl: resultsEl as unknown as HTMLUListElement,
    runQuery: (q) => {
      queries.push(q);
      return q === '' ? CORPUS : CORPUS.filter((n) => n.toLowerCase().startsWith(q.toLowerCase()));
    },
    rowFor: (item) => ({ primary: item, sub: 'star' }),
    onSelect: (item) => { selected.push(item); },
    // Snapshot of what the X handler left behind before refocus.
    onClear: () => { clearedValues.push(input.value); },
    clearBtn: clearBtn as unknown as HTMLButtonElement,
    ...overrides,
  });
  return { input, resultsEl, clearBtn, selected, clearedValues, queries, typeahead };
}

function activeRows(resultsEl: ElStub): number[] {
  return resultsEl.children
    .map((li, i) => (li.classes.has(TYPEAHEAD_ACTIVE_CLASS) ? i : -1))
    .filter((i) => i >= 0);
}

describe('Typeahead / setName', () => {
  it('writes the name into the input while unfocused', () => {
    const { input, typeahead } = makeTypeahead();
    typeahead.setName('Vega');
    expect(input.value).toBe('Vega');
  });

  it('preserves in-progress typing while focused, restoring on blur', () => {
    const { input, typeahead } = makeTypeahead();
    input.focus();
    input.type('Sir');
    typeahead.setName('Vega');
    expect(input.value).toBe('Sir');
    input.blur();
    vi.advanceTimersByTime(140);
    expect(input.value).toBe('Vega');
  });

  it('shows the clear button only for a non-empty name', () => {
    const { clearBtn, typeahead } = makeTypeahead();
    typeahead.setName('Vega');
    expect(clearBtn.hidden).toBe(false);
    typeahead.setName('');
    expect(clearBtn.hidden).toBe(true);
  });

  it('is a no-op on the clear button when none was provided', () => {
    const { clearBtn, typeahead } = makeTypeahead({ clearBtn: undefined });
    typeahead.setName('Vega');
    expect(clearBtn.hidden).toBe(false);
  });
});

describe('Typeahead / TypeaheadGroup ownership', () => {
  it('claims the group on focus and releases it on the deferred blur', () => {
    const group = new TypeaheadGroup();
    const { input, resultsEl, typeahead } = makeTypeahead({ group });
    input.focus();
    expect(group.active).toBe(typeahead);
    expect(resultsEl.hidden).toBe(false);
    input.blur();
    // The hide is deferred so a row mousedown wins the race.
    expect(resultsEl.hidden).toBe(false);
    vi.advanceTimersByTime(140);
    expect(group.active).toBeNull();
    expect(resultsEl.hidden).toBe(true);
  });

  it('keeps the shared dropdown open when a sibling has claimed the group', () => {
    const group = new TypeaheadGroup();
    const resultsEl = new ElStub();
    const a = makeTypeahead({ group, resultsEl: resultsEl as unknown as HTMLUListElement });
    const b = makeTypeahead({ group, resultsEl: resultsEl as unknown as HTMLUListElement });
    a.typeahead.setName('Vega');
    a.input.focus();
    // Focus moves between the focus + to inputs: b claims before a's
    // deferred blur-hide fires.
    b.input.focus();
    a.input.blur();
    vi.advanceTimersByTime(140);
    expect(group.active).toBe(b.typeahead);
    expect(resultsEl.hidden).toBe(false);
    // a's own displayName still restores even though the group moved on.
    expect(a.input.value).toBe('Vega');
  });
});

describe('Typeahead / clear button', () => {
  it('clears the input before onClear so the refocus re-renders empty', () => {
    const h = makeTypeahead();
    h.typeahead.setName('Vega');
    h.input.focus();
    h.input.type('Sir');
    h.queries.length = 0;
    h.clearBtn.dispatchEvent(new Event('click'));
    // The value onClear observed — a stale query here re-renders the
    // dropdown against the orphaned prior text on the synthetic focus.
    expect(h.clearedValues).toEqual(['']);
    expect(h.queries).toEqual(['']);
    expect(h.input.focused).toBe(true);
  });
});

describe('Typeahead / keyboard', () => {
  it('wraps arrow navigation in both directions', () => {
    const { input, resultsEl } = makeTypeahead();
    input.focus(); // renders the full corpus, hover on row 0
    expect(activeRows(resultsEl)).toEqual([0]);
    expect(input.keydown('ArrowUp').defaultPrevented).toBe(true);
    expect(activeRows(resultsEl)).toEqual([CORPUS.length - 1]);
    input.keydown('ArrowDown');
    expect(activeRows(resultsEl)).toEqual([0]);
    input.keydown('ArrowDown');
    input.keydown('ArrowDown');
    input.keydown('ArrowDown');
    expect(activeRows(resultsEl)).toEqual([0]);
  });

  it('Enter picks the hovered row', () => {
    const { input, resultsEl, selected } = makeTypeahead();
    input.focus();
    input.keydown('ArrowDown');
    expect(input.keydown('Enter').defaultPrevented).toBe(true);
    expect(selected).toEqual([CORPUS[1]]);
    expect(resultsEl.hidden).toBe(true);
    expect(input.focused).toBe(false);
  });

  it('Enter with no results does nothing', () => {
    const { input, selected } = makeTypeahead();
    input.focus();
    input.type('zzz');
    expect(input.keydown('Enter').defaultPrevented).toBe(false);
    expect(selected).toEqual([]);
  });

  it('Escape hides and blurs but leaves the event unprevented for global handlers', () => {
    const { input, resultsEl } = makeTypeahead();
    input.focus();
    const e = input.keydown('Escape');
    expect(resultsEl.hidden).toBe(true);
    expect(input.focused).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('Typeahead / pick', () => {
  it('announces typeahead-pick before onSelect, then hides and blurs', () => {
    const { input, resultsEl, selected } = makeTypeahead();
    const order: string[] = [];
    input.addEventListener('typeahead-pick', () => { order.push('event'); });
    input.focus();
    resultsEl.children[2].dispatchEvent(new Event('mousedown', { cancelable: true }));
    order.push('after');
    expect(selected).toEqual([CORPUS[2]]);
    // The hosting modal tears itself down on this event, so it must fire
    // before onSelect starts a camera animation.
    expect(order).toEqual(['event', 'after']);
    expect(resultsEl.hidden).toBe(true);
    expect(input.focused).toBe(false);
  });

  it('renders a row per result and hides the dropdown when empty', () => {
    const { input, resultsEl } = makeTypeahead();
    input.focus();
    expect(resultsEl.children).toHaveLength(CORPUS.length);
    input.type('zzz');
    expect(resultsEl.hidden).toBe(true);
  });
});

describe('Typeahead / debounced queries', () => {
  const debounceMs = 250;

  it('coalesces keystrokes into one trailing query', () => {
    const { input, queries } = makeTypeahead({ debounceMs });
    input.type('S');
    input.type('Si');
    input.type('Sir');
    expect(queries).toEqual([]);
    vi.advanceTimersByTime(debounceMs);
    expect(queries).toEqual(['Sir']);
  });

  it('Enter flushes the pending query so it selects against the full text', () => {
    const { input, selected } = makeTypeahead({ debounceMs });
    input.focus();
    input.type('Rig');
    input.keydown('Enter');
    expect(selected).toEqual(['Rigel']);
  });

  it('drops a pending query on blur so it cannot re-show the dropdown', () => {
    const { input, resultsEl, queries } = makeTypeahead({ debounceMs });
    input.focus();
    input.type('Sir');
    input.blur();
    queries.length = 0;
    vi.advanceTimersByTime(debounceMs + 140);
    expect(queries).toEqual([]);
    expect(resultsEl.hidden).toBe(true);
  });
});
