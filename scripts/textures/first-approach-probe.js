// Console probe for stellata-2f6.32: does the first-approach texture upload
// and shader link actually cost a visible frame gap?
//
// Paste into the DevTools console on a FRESH page load, before flying
// anywhere, then run one Voyager 2 flythrough past the four giants and call
// __approachProbe.report(). Manual only — the WebGL render loop holds the GPU
// and headless capture stalls on readback (bd: stellata-smoke-tests).
//
// It wraps the GL entry points the bead is actually about, so a slow frame is
// attributed rather than guessed at: the decode already runs off-thread
// through ImageBitmapLoader, so what can still block the render thread is the
// upload, the mipmap chain, and the program link.
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
  };

  let live = { upload: 0, mipmap: 0, link: 0, n: 0, bytes: 0 };
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
        // Source dimensions where the call carries them, so an 8192 rung is
        // distinguishable from a 1024 one in the log.
        const src = args[args.length - 1];
        if (src && typeof src === 'object' && src.width) {
          live.bytes = Math.max(live.bytes, src.width);
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
    live = { upload: 0, mipmap: 0, link: 0, n: 0, bytes: 0 };
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
      // slow frames, which is a different bead entirely (stellata-8cg.14).
      const isSlow = new Set(slow.map((f) => f.i));
      const rows = slow.map((f) => ({
        frame: f.i,
        gap: round(f.gap),
        upload: round(f.upload),
        mipmap: round(f.mipmap),
        link: round(f.link),
        glCalls: f.n,
        widestSrc: f.bytes || '',
        kind:
          isSlow.has(f.i - 1) || isSlow.has(f.i + 1) ? 'burst' : 'ISOLATED',
      }));
      console.table(rows);

      const sum = (k) => slow.reduce((a, f) => a + f[k], 0);
      const isolated = rows.filter((r) => r.kind === 'ISOLATED');
      const attributed = sum('upload') + sum('mipmap') + sum('link');
      console.log(
        `[approach-probe] ${frames.length} frames · ${slow.length} over ` +
          `${slowMs} ms (${isolated.length} isolated, ` +
          `${slow.length - isolated.length} in bursts) · worst ` +
          `${round(Math.max(...slow.map((f) => f.gap)))} ms\n` +
          `  attributed to GL: upload ${round(sum('upload'))} ms, mipmap ` +
          `${round(sum('mipmap'))} ms, link ${round(sum('link'))} ms ` +
          `= ${round(attributed)} ms of ${round(sum('gap'))} ms slow-frame time ` +
          `(${Math.round((100 * attributed) / sum('gap'))} %)`,
      );
      console.log(
        'Read it as: ISOLATED rows with most of their gap in upload/mipmap/link ' +
          'are this bead. Burst rows with little attributed GL time are not — ' +
          'they are per-frame render cost and belong to stellata-8cg.14.',
      );
    },
  };

  console.log(
    '[approach-probe] installed. Fly one Voyager 2 pass over the four ' +
      'giants, then call __approachProbe.report().',
  );
})();
