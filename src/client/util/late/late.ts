// A value that lands after construction, as pending / ready / absent. See README.md.

import { fanOut } from '../fan-out';

export type LateState<T> =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'absent' };

export type SettledState<T> = Exclude<LateState<T>, { readonly status: 'pending' }>;

export interface Late<T> {
  state(): LateState<T>;
  /** Runs `fn` now if already settled, then on every later settle. */
  observe(fn: (settled: SettledState<T>) => void): () => void;
}

const PENDING = { status: 'pending' } as const;
const ABSENT = { status: 'absent' } as const;

export class LateCell<T> implements Late<T> {
  private current: LateState<T> = PENDING;
  private readonly observers = new Set<(settled: SettledState<T>) => void>();

  state(): LateState<T> {
    return this.current;
  }

  observe(fn: (settled: SettledState<T>) => void): () => void {
    this.observers.add(fn);
    const now = this.current;
    if (now.status !== 'pending') fn(now);
    return () => { this.observers.delete(fn); };
  }

  land(value: T): void {
    this.settle({ status: 'ready', value });
  }

  /** Settle as never arriving this session: a missing artifact, a failed load, a detach. */
  conclude(): void {
    this.settle(ABSENT);
  }

  private settle(next: SettledState<T>): void {
    this.current = next;
    fanOut('LateCell.settle', [...this.observers], (fn) => fn(next));
  }
}

/** Ready when `promise` resolves, absent when it rejects. */
export function lateFromPromise<T>(promise: Promise<T>): Late<T> {
  const cell = new LateCell<T>();
  promise.then((value) => cell.land(value), () => cell.conclude());
  return cell;
}

/** `source` seen through `f`, which runs once per settle, not per read. */
export function mapLate<T, U>(source: Late<T>, f: (value: T) => U): Late<U> {
  let current: LateState<U> = PENDING;
  // Registered before any reader can subscribe, so `current` is already the
  // new projection when a reader's observer runs.
  source.observe((s) => {
    current = s.status === 'ready' ? { status: 'ready', value: f(s.value) } : ABSENT;
  });
  return {
    state: () => current,
    observe: (fn) => source.observe(() => fn(current as SettledState<U>)),
  };
}
