// A catalogue whose records arrive in no spatial order — the shape the
// dispatch sort exists for. Test-only.

/** `side`³ cells of 10 pc, walked by a stride coprime with the cell count so
 *  every cell is visited once. A monotone field sorts to the identity and
 *  lets a mispaired table pass, which is what this exists to avoid. */
export function scrambledLattice(side: number, stride: number): Float32Array {
  const count = side ** 3;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const cell = (i * stride) % count;
    positions[i * 3] = (cell % side) * 10;
    positions[i * 3 + 1] = (Math.floor(cell / side) % side) * 10;
    positions[i * 3 + 2] = Math.floor(cell / (side * side)) * 10;
  }
  return positions;
}
