// Non-blocking readback of the reduction's 1x1 level: a pixel-pack buffer
// plus a fence, polled once a frame. See README.md § Latency.

export class ReductionReadback {
  private readonly gl: WebGL2RenderingContext;
  private readonly buffer: WebGLBuffer | null;
  private readonly pixels: Float32Array;
  private fence: WebGLSync | null = null;
  private pendingCount = 0;

  constructor(gl: WebGL2RenderingContext, maxTexels: number) {
    this.gl = gl;
    this.pixels = new Float32Array(maxTexels * 4);
    this.buffer = gl.createBuffer();
    if (this.buffer === null) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /** One readback in flight at a time, so the statistic refreshes every
   *  other frame at worst — far inside `ADAPT_SLEW_TAU_S`. */
  get pending(): boolean {
    return this.fence !== null;
  }

  /** Read `count`×1 RGBA float texels out of the **currently bound**
   *  framebuffer. No-op while one is already in flight.
   *
   *  RGBA/FLOAT is guaranteed only for an RGBA32F attachment, which is why
   *  the chain's last level alone is 32-bit (README.md § The chain). */
  request(count: number): void {
    const gl = this.gl;
    if (this.buffer === null || this.fence !== null || count <= 0) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
    gl.readPixels(0, 0, count, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence === null) return;
    gl.flush();
    this.fence = fence;
    this.pendingCount = count;
  }

  /** The pixels once the GPU is done with them, else null. Never blocks:
   *  `getBufferSubData` would stall the pipeline, which is the whole thing
   *  the fence exists to avoid. */
  poll(): { pixels: Float32Array; count: number } | null {
    const gl = this.gl;
    const fence = this.fence;
    if (fence === null) return null;
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return null;
    gl.deleteSync(fence);
    this.fence = null;
    const count = this.pendingCount;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels, 0, count * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return { pixels: this.pixels, count };
  }

  dispose(): void {
    const gl = this.gl;
    if (this.fence !== null) {
      gl.deleteSync(this.fence);
      this.fence = null;
    }
    if (this.buffer !== null) gl.deleteBuffer(this.buffer);
    this.pendingCount = 0;
  }
}
