// Console probe attributing a first approach's slow frames to the GL work in
// them — upload, mipmap chain, program link, or a readback stalling on a
// fence. Paste into DevTools on a fresh load; see README.md for what it settles.
(() => {
  const proto = WebGL2RenderingContext.prototype;
  if (proto.__approachProbeInstalled) {
    console.warn('[approach-probe] already installed; reload to reset');
    return;
  }
  proto.__approachProbeInstalled = true;

  // Buckets, and which GL calls feed them. Each is rare — per texture or per
  // program, never per draw — so the wrapper cannot distort the frame it is
  // measuring the way wrapping uniform/attribute calls would.
  const BUCKETS = {
    upload: ['texImage2D', 'texSubImage2D', 'texStorage2D', 'compressedTexImage2D'],
    mipmap: ['generateMipmap'],
    link: ['compileShader', 'linkProgram', 'getProgramParameter'],
    // The stall suspects, and the reason a frame can be enormous with no
    // texture or shader work in it at all. The exposure adaptation reads its
    // statistic back through readPixels into a pack buffer and picks it up
    // with getBufferSubData behind a fence; a fence waited on before it
    // signals blocks the main thread here rather than inside any draw.
    readback: ['readPixels', 'getBufferSubData'],
    sync: ['clientWaitSync', 'fenceSync', 'finish', 'flush'],
  };

  const zero = () => ({
    upload: 0, mipmap: 0, link: 0, readback: 0, sync: 0, n: 0,
    // Uploads counted SEPARATELY from n. n is every wrapped call of any
    // bucket, so it cannot answer the only question the upload-rate cap turns
    // on: how many TEXTURES landed in this one frame. Widths name them.
    uploads: 0, widths: [],
  });
  let live = zero();
  const frames = [];

  for (const [bucket, names] of Object.entries(BUCKETS)) {
    for (const name of names) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function (...args) {
        const t0 = performance.now();
        const out = orig.apply(this, args);
        live[bucket] += performance.now() - t0;
        live.n++;
        if (bucket === 'upload') {
          live.uploads++;
          // Source width where the call carries it, so an 8192 rung is
          // distinguishable from a 1024 one in the log.
          const src = args[args.length - 1];
          const w = src && typeof src === 'object' ? src.width : 0;
          if (w) live.widths.push(w);
        }
        return out;
      };
    }
  }

  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    // GL work done during the frame just ended lands in `live`; snapshot it
    // against that frame's own gap.
    frames.push({ gap: now - last, ...live });
    live = zero();
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const round = (v) => Math.round(v * 10) / 10;

  window.__approachProbe = {
    frames,
    /** @param slowMs frames slower than this are reported individually. */
    report(slowMs = 50) {
      const slow = frames
        .map((f, i) => ({ i, ...f }))
        .filter((f) => f.gap > slowMs);
      if (!slow.length) {
        console.log(
          `[approach-probe] ${frames.length} frames, none over ${slowMs} ms. ` +
            'That is the "not worth a session" answer the bead asks for.',
        );
        return;
      }
      // The discriminator the earlier measurement lacked. A one-shot upload or
      // link is an ISOLATED spike; a sustained per-frame cost shows as a run of
      // slow frames, which is the frame-cost epic's problem, not this one.
      const isSlow = new Set(slow.map((f) => f.i));
      const rows = slow.map((f) => ({
        frame: f.i,
        gap: round(f.gap),
        upload: round(f.upload),
        mipmap: round(f.mipmap),
        link: round(f.link),
        readback: round(f.readback),
        sync: round(f.sync),
        uploads: f.uploads,
        widths: f.widths.join(' '),
        glCalls: f.n,
        kind:
          isSlow.has(f.i - 1) || isSlow.has(f.i + 1) ? 'burst' : 'ISOLATED',
      }));
      console.table(rows);

      const sum = (k) => slow.reduce((a, f) => a + f[k], 0);
      const isolated = rows.filter((r) => r.kind === 'ISOLATED');
      const attributed =
        sum('upload') + sum('mipmap') + sum('link') + sum('readback') + sum('sync');
      console.log(
        `[approach-probe] ${frames.length} frames · ${slow.length} over ` +
          `${slowMs} ms (${isolated.length} isolated, ` +
          `${slow.length - isolated.length} in bursts) · worst ` +
          `${round(Math.max(...slow.map((f) => f.gap)))} ms\n` +
          `  attributed to GL: upload ${round(sum('upload'))} ms, mipmap ` +
          `${round(sum('mipmap'))} ms, link ${round(sum('link'))} ms, readback ` +
          `${round(sum('readback'))} ms, sync ${round(sum('sync'))} ms ` +
          `= ${round(attributed)} ms of ${round(sum('gap'))} ms slow-frame time ` +
          `(${Math.round((100 * attributed) / sum('gap'))} %)`,
      );
      console.log(
        'Read it as: upload/mipmap/link is the first-approach cost. ' +
          'readback/sync is the main thread blocking on the GPU, which is what ' +
          'a fence waited on too early looks like. A big gap with NO bucket ' +
          'accounted is CPU work outside GL, or the driver blocking inside a ' +
          'draw call — neither of which this probe can see.',
      );
    },
  };

  console.log(
    '[approach-probe] installed. Fly one Voyager 2 pass over the four ' +
      'giants, then call __approachProbe.report().',
  );
})();
