// Last-warp summary slot: written by WarpController at finishWarp, read
// by the warp-tuning debug readout. Nothing in the shipped warp path
// reads from here.

export interface LastWarpSummary {
  sourceKind: string;
  sourceIdx: number;
  destKind: string;
  destIdx: number;
  totalMs: number;
  plateauFired: boolean;
  plateauDistPc: number | null;
}

let lastWarp: LastWarpSummary | null = null;

export function recordLastWarp(summary: LastWarpSummary): void {
  lastWarp = summary;
}

export function getLastWarp(): LastWarpSummary | null {
  return lastWarp;
}
