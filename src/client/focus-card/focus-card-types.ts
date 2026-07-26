// The FocusCardProvider contract and the focusable-kind union it is
// exhaustively keyed on. See ./README.md.

/** Every object kind the app can focus. Extending this union without
 *  adding a provider to `FocusCardProviders` fails the TypeScript
 *  build — that is the contract, not a convention. */
export type FocusKind = 'star' | 'cloud' | 'lg' | 'planet' | 'shell' | 'probe';

export interface FocusCardRow {
  label: string;
  /** Static rows are plain strings, rebuilt on focus change. A function
   *  marks the row LIVE: the engine re-evaluates it every frame while
   *  the card is visible (camera distance, apparent mag from camera). */
  value: string | (() => string);
}

export interface FocusCardContent {
  /** Header title — the object's preferred display name. */
  name: string;
  /** Identity lines under the header: alternate designations, class +
   *  descriptor. Rendered dimmed, no label column. */
  identityLines: string[];
  rows: FocusCardRow[];
  /** Full-width lines after the rows (companion blocks). A function
   *  entry is LIVE like a function-valued row; embedded newlines render
   *  as line breaks. */
  lines: Array<string | (() => string)>;
}

export interface FocusCardProvider<K extends FocusKind = FocusKind> {
  readonly kind: K;
  format(idx: number): FocusCardContent;
}

/** Exhaustive over FocusKind by construction — a new focusable kind
 *  cannot ship without its card provider. */
export type FocusCardProviders = { readonly [K in FocusKind]: FocusCardProvider<K> };
