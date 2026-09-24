# Dust particle sprite on WebGPU

The dust-particle billboard's graph. Its CPU half — the layer, the
loader and the authored constants — is `../../dust/`.

**The layer it belongs to is shelved, and this folder is slated to go
with it** (`../../dust/README.md`): strength is 0, the mesh is hidden,
`particles.bin` is never fetched, and the decision is to remove the
particle layer rather than un-shelve it. So the sprite has no smoke of
its own — the only way to see it is `stellata.setParticleStrength(>0)`
from the console. The shelved layer still constructs its material on
every boot, so a surface this factory cannot build is a boot that
throws, not a layer that stays dark.

## Files in this area

```
src/client/webgpu/dust/
  dust-particle-tsl.ts     The sprite's vertex and fragment graphs.
  dust-uniform-nodes.ts    uParticleStrength, the one slot the layer owns.
  tsl-dust-materials.ts    The factory implementing DustParticleMaterials.
  dust-tsl-drift.test.ts   The constant guard (README.md#constants-live-in-typescript).
```

## Six of its seven uniforms are not in its own record

The sprite reads `uPixelRatio`, `uViewport`, `uWorldOffset`,
`uDustEnabled`, `uDustDensityMin` and `uDustLogRatio` off the
uniform-node mirror ([Shared uniform nodes](../tsl/README.md#shared-uniform-nodes)), the
by-reference channel every writer already feeds.

`uParticleStrength` is the layer's own, and the one slot
`uniformSlotsOf` has to expose so `setStrength` reaches the shader.

## Two quantities that divide out

The graph carries neither — the same simplification the probe glyph
carries (`../solar-system/README.md`).

- **`uPixelRatio`.** The corner offset would be multiplied by it and then
  divided by `uViewport * uPixelRatio`. It cancels exactly.
- **A base-10 conversion.** `uDustLogRatio` is authored as a NATURAL log
  (`frame/shared-uniforms.ts`, `Math.log(1e3)`), so the base cancels out
  of `(logD − logMin) / logSpan`. The degenerate-span guard
  `max(logSpan, 0.001)` is therefore a natural-log floor; at the authored
  6.9078 it is never reached, and any span that low produces meaningless
  `normD` regardless.

Leaving the conversion out is also what keeps this shader's constants
whole: a `Math.log(10)` here would be the one number neither imported
from `dust-particle-pure.ts` nor pinned.

## Constants live in TypeScript

`PARTICLE_MIN_PX`, `PARTICLE_MAX_PX`, `PARTICLE_DIM_FLOOR` and
`DUST_TINT` are imported from `../../dust/dust-particle-pure.ts`, so no
copy exists to drift. What `dust-tsl-drift.test.ts` still holds is the
other direction — that this side names each constant and spells none of
them as a literal ([TSL test pattern](../tsl/README.md#tsl-test-pattern--what-a-layers-suite-covers)), which an import
does not prevent.

**The tint is the one chrome colour still unmapped.** It is a shader
constant rather than a uniform, so it never goes through the inverse
tone-map the other chrome layers take (`../../hdr/chrome/README.md`). The
debt retires with the layer.
