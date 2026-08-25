# Dust particle sprite on WebGPU

The TSL half of the dust-particle billboard. The WebGL2 shaders
(`../../dust/`) stay the shipped renderer and the semantic reference.

**The layer it belongs to is shelved** (`../../dust/README.md`): strength
is 0, the mesh is hidden, and `particles.bin` is never fetched. So this
port has no smoke of its own until someone calls
`stellata.setParticleStrength(>0)` from the console — which is also the
only way to see it on the WebGL build. Ported anyway because the shelved
layer still constructs on both boots, and a material the seam cannot
build is a boot that throws rather than a layer that stays dark.

## Files in this area

```
src/client/webgpu/dust/
  dust-particle-tsl.ts     The sprite's vertex and fragment graphs.
  dust-uniform-nodes.ts    uParticleStrength, the one slot the layer owns.
  tsl-dust-materials.ts    The factory implementing DustParticleMaterials.
  dust-tsl-drift.test.ts   The TSL-side constant guard (§ Constants live
                           in TypeScript).
```

## Six of its seven uniforms are not in its own record

The sprite reads `uPixelRatio`, `uViewport`, `uWorldOffset`,
`uDustEnabled`, `uDustDensityMin` and `uDustLogRatio` — all six shared
by reference on the WebGL path, all six already in the uniform-node
mirror (`../tsl/README.md` § Shared uniform nodes). So the TSL factory
takes them off `cfg.nodes` and **ignores the `shared` argument the seam
hands it**: the argument exists because the WebGL layer's constructor
needs it, and honouring it here would mean writing a second, divergent
by-reference channel.

`uParticleStrength` is the layer's own, and the one slot
`uniformSlotsOf` has to expose so `setStrength` reaches either backend
unchanged.

## Two no-ops the graph drops

The GLSL carries two quantities that divide out of their own expression,
and the TSL transcribes neither — the same simplification the probe glyph
carries (`../solar-system/README.md`).

- **`uPixelRatio`.** The corner offset is multiplied by it and then
  divided by `uViewport * uPixelRatio`. It cancels exactly.
- **The base-10 conversion.** The GLSL divides `logD`, `logMin` and
  `logSpan` by a local `LOG10`, but `uDustLogRatio` is authored as a
  NATURAL log (`frame/shared-uniforms.ts`, `Math.log(1e3)`), so the base
  cancels out of `(logD − logMin) / logSpan`. The one place it does not
  cancel is the degenerate-span guard: `max(logSpan, 0.001)` floors a
  base-10 span on the GLSL side and a natural-log one here, i.e. at
  `uDustLogRatio` of 0.0023 versus 0.001. At the authored 6.9078 neither
  floor is reached, and any span that low produces meaningless `normD` on
  both backends.

Dropping the conversion is also what keeps this shader's constants
whole: a TSL-side `Math.log(10)` would be the one number here that is
neither imported from `dust-particle-pure.ts` nor pinned against the
GLSL, and it disagrees with the GLSL's 10-digit literal in the 11th
digit.

## Constants live in TypeScript

`PARTICLE_MIN_PX`, `PARTICLE_MAX_PX`, `PARTICLE_DIM_FLOOR` and
`DUST_TINT` are imported from `../../dust/dust-particle-pure.ts`, and the
guard runs in **both** directions, as it does for the solar-system
surfaces (`../solar-system/README.md` § Constant drift runs in both
directions): `dust-particle-glsl-drift.test.ts` pins the GLSL's copies
against that module, since GLSL cannot import; `dust-tsl-drift.test.ts`
asserts this side names each constant and spells none of them as a
literal (`../tsl/README.md` § TSL test pattern).

**The tint is the one chrome colour still unmapped.** It is a shader
constant rather than a uniform, so it never went through the inverse
tone-map the other chrome layers take, on either backend. Unshelving the
layer owes that pass a look (`../../hdr/chrome/README.md`) — this port
carries the defect across rather than silently fixing it, so the two
backends still agree.
