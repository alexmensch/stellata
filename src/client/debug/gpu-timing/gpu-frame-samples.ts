// Whole-frame GPU durations the render loop measures itself, fanned out
// to every consumer that wants them. See README.md § GPU timing.

type Subscriber = (ms: number) => void;

const subscribers = new Set<Subscriber>();

/**
 * Publish one frame's measured GPU milliseconds.
 *
 * Only the WebGPU branch of the render loop publishes: on WebGL2 the
 * whole-frame scope is measured by whichever GL timer currently owns the
 * context's single query slot (the HUD's or the pricing harness's), and
 * publishing there as well would record `gpu.frame` twice per frame.
 */
export function publishGpuFrameSample(ms: number): void {
  for (const s of subscribers) s(ms);
}

/**
 * Subscribe to those samples; the return value unsubscribes.
 *
 * Several consumers may listen at once — the HUD and the pricing harness
 * together, for instance. That is the WebGPU-side departure from WebGL2,
 * where a timer query is an exclusive resource and the harness therefore
 * demands a closed panel.
 */
export function onGpuFrameSample(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
