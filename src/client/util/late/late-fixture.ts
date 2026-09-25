// Test-only builders for a Late already in a given state.

import { LateCell, type Late } from './late';

export function lateReady<T>(value: T): Late<T> {
  const cell = new LateCell<T>();
  cell.land(value);
  return cell;
}

export function lateAbsent<T>(): Late<T> {
  const cell = new LateCell<T>();
  cell.conclude();
  return cell;
}
