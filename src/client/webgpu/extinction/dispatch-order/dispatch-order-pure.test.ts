import { describe, expect, it } from 'vitest';
import {
  MORTON_BITS_PER_AXIS, mortonDispatchOrder, scatterByOrder, writeDispatchTablesInto,
} from './dispatch-order-pure';
import { scrambledLattice } from './dispatch-order-fixture';

const SIDE = 12;
const COUNT = SIDE ** 3;
const lattice = () => scrambledLattice(SIDE, 1129);

function meanConsecutiveGap(positions: Float32Array, order: Uint32Array): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1];
    const b = order[i];
    const dx = positions[a * 3] - positions[b * 3];
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total / (order.length - 1);
}

const identity = (count: number) => Uint32Array.from({ length: count }, (_, i) => i);

describe('mortonDispatchOrder', () => {
  it('holds every star exactly once', () => {
    const order = mortonDispatchOrder(lattice(), COUNT);
    expect(order).toHaveLength(COUNT);
    expect(new Set(order).size).toBe(COUNT);
  });

  // The whole point of the reorder: neighbouring threads march neighbouring
  // sight-lines, so they share memory transactions through the dust volume.
  // 10 pc is the lattice's nearest-neighbour distance — the floor a perfect
  // order would reach.
  it('cuts the gap between consecutive threads by ~4.9x', () => {
    const positions = lattice();
    expect(meanConsecutiveGap(positions, identity(COUNT))).toBeCloseTo(72.8733, 3);
    const order = mortonDispatchOrder(positions, COUNT);
    expect(meanConsecutiveGap(positions, order)).toBeCloseTo(14.7789, 3);
  });

  it('is deterministic — the same catalogue gives the same dispatch', () => {
    const positions = lattice();
    expect(Array.from(mortonDispatchOrder(positions, COUNT)))
      .toEqual(Array.from(mortonDispatchOrder(positions, COUNT)));
  });

  it('survives a catalogue with no extent at all', () => {
    const order = mortonDispatchOrder(new Float32Array(30), 10);
    expect(Array.from(order)).toEqual(Array.from(identity(10)));
  });

  it('survives a flat catalogue — a degenerate axis quantises to zero', () => {
    const positions = new Float32Array(12);
    for (let i = 0; i < 4; i++) positions[i * 3] = 3 - i;
    const order = mortonDispatchOrder(positions, 4);
    expect(Array.from(order)).toEqual([3, 2, 1, 0]);
  });

  it('a one-star and an empty catalogue need no sort', () => {
    expect(Array.from(mortonDispatchOrder(new Float32Array(3), 1))).toEqual([0]);
    expect(mortonDispatchOrder(new Float32Array(0), 0)).toHaveLength(0);
  });

  // ./README.md § Dispatch order: the spreader binds, not the key word.
  it('quantises each axis to the widest half the spreader accepts', () => {
    expect(MORTON_BITS_PER_AXIS).toBe(16);
    expect(MORTON_BITS_PER_AXIS >> 1).toBe(8);
  });
});

describe('writeDispatchTablesInto', () => {
  it('writes the Morton order and its inverse, composing to the identity both ways', () => {
    const positions = lattice();
    const order = new Uint32Array(COUNT);
    const slotOf = new Uint32Array(COUNT);
    writeDispatchTablesInto(order, slotOf, positions, COUNT);
    expect(Array.from(order)).toEqual(Array.from(mortonDispatchOrder(positions, COUNT)));
    for (let slot = 0; slot < COUNT; slot++) expect(slotOf[order[slot]]).toBe(slot);
    for (let star = 0; star < COUNT; star++) expect(order[slotOf[star]]).toBe(star);
  });

  it('leaves the table past count untouched', () => {
    const positions = Float32Array.from([3, 0, 0, 1, 0, 0, 2, 0, 0]);
    const order = new Uint32Array(3);
    const slotOf = new Uint32Array(5).fill(99);
    writeDispatchTablesInto(order, slotOf, positions, 3);
    expect(Array.from(order)).toEqual([1, 2, 0]);
    expect(Array.from(slotOf)).toEqual([2, 0, 1, 99, 99]);
  });
});

describe('scatterByOrder', () => {
  it('puts slot i back at star order[i]', () => {
    const order = Uint32Array.from([2, 0, 3, 1]);
    const out = scatterByOrder(Float32Array.from([10, 20, 30, 40]), order, 4);
    expect(Array.from(out)).toEqual([20, 40, 10, 30]);
  });

  it('reads one component out of a wider texel', () => {
    const order = Uint32Array.from([1, 0]);
    const src = Float32Array.from([7, 0, 0, 0, 9, 0, 0, 0]);
    expect(Array.from(scatterByOrder(src, order, 2, 4))).toEqual([9, 7]);
  });

  // The parity check compares float32 bit patterns, so two NaNs with
  // different payloads have to stay distinguishable across the move.
  it('moves bits, so a NaN payload survives', () => {
    const src = new Float32Array(2);
    new Uint32Array(src.buffer).set([0x7fc0_0001, 0x7fc0_0002]);
    const out = scatterByOrder(src, Uint32Array.from([1, 0]), 2);
    expect(Array.from(new Uint32Array(out.buffer))).toEqual([0x7fc0_0002, 0x7fc0_0001]);
  });
});
