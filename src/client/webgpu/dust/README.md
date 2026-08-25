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

## `uPixelRatio` cancels

The GLSL multiplies the corner offset by `uPixelRatio` and then divides
by `uViewport * uPixelRatio`, so the ratio cancels exactly. The TSL graph
drops both rather than transcribing a no-op — the same simplification the
probe glyph carries (`../solar-system/README.md`).

## Constants live in TypeScript

`PARTICLE_MIN_PX`, `PARTICLE_MAX_PX`, `PARTICLE_DIM_FLOOR` and
`DUST_TINT` are imported from `../../dust/dust-particle-pure.ts`; the
GLSL's copies are pinned against that module by
`dust-particle-glsl-drift.test.ts`, since GLSL cannot import
(`../tsl/README.md` § TSL test pattern).

**The tint is the one chrome colour still unmapped.** It is a shader
constant rather than a uniform, so it never went through the inverse
tone-map the other chrome layers take, on either backend. Unshelving the
layer owes that pass a look (`../../hdr/chrome/README.md`) — this port
carries the defect across rather than silently fixing it, so the two
backends still agree.
