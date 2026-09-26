# Pose change — when a camera has moved

```
pose-change-pure.ts (+ test)   the one scale-free test behind both the
                               per-frame URL write trigger and the
                               encoder's cam / tgt / worldOffset elision
                               in ../url-state.ts.
```

## What counts as a camera move

Every threshold on a pose vector — the per-frame write trigger and the
encoder's cam / tgt / worldOffset elision alike — is **a fraction of the
orbit radius `|cam − tgt|`, never a distance**. `pose-change-pure.ts` owns
the rule and the one constant, `POSE_CHANGE_EPS`.

The rule is angular and metric at once, which is why it needs no cases:
`|Δcam| / r` IS the angle the move subtends at the orbit target, so an orbit
gesture and a dolly land on the same test. Pan and OBSERVE's look-around
land in `tgt` against the same radius; roll moves neither point and is read
off `camera.up`, a unit axis whose delta is the roll angle itself. OBSERVE
has no orbit pivot but still carries a radius — the serialised look pin a
parsec down the forward axis (`../../../camera/observe/README.md`).

**An absolute threshold is wrong at every vantage but one**, and this camera
reaches lunar orbit and the Local Group in a session ([Camera-anywhere](/AGENTS.md#camera-anywhere-any-epoch--a-mental-model-rule)).
The rule this replaced was `max(1e-9 pc, min(1e-3 pc,
1 % of magnitude))`, and each term failed somewhere: the 1e-9 pc floor is
**30,857 km**, so beside the Moon the camera had to travel seven times its
own distance from the body before the URL was rewritten and a whole orbit
went unrecorded; the 1e-3 pc encoder band called a 30-billion-km pan
"default", and called the anchor of every unfocused view inside the solar
system "Sol", so the receiver rebuilt the pose 1 AU away.

**The pose is measured from the anchor the RECEIVER rebuilds**, not from the
local origin — `../url-state.ts`'s `anchoredPose`, which both writers read
so they cannot disagree about what has moved. A hard focus recentres the
origin onto the object at apply time, while the sender's own recentre fires
only once the camera has drifted 16× the eye distance
(`../../../camera/focus/focal-ride/focal-ride-pure.ts`). Between two of those the
moving-focal ride carries camera and target along with the object: raw local
values drift out of any frame the receiver reconstructs, and they carry
motion the viewer cannot see, which under a scale-relative trigger is
unbounded URL churn against a *trailing* debounce — that is, no URL write at
all. Subtracting the anchor removes both.

<a id="worldoffset-carries-the-frame"></a>**Where no anchor is subtracted, `worldOffset` carries the frame instead**, and
the encoder gates that field on the exact complement of this test rather than
on a second rule of its own. Three cases leave the pose un-anchored: nothing
focused, a source that will not resolve, and a **soft-kind focus** — only a
hard kind recentres the origin (`../../../camera/focus/focus-target.ts`
`KIND_TRAITS`), so a cloud, an LG object or a shell can be focused with the
frame still sitting on whatever was focused before it.

Two bounds fix the constant: below ~1e-3 the round-trip error is sub-pixel
on any display, and it has to stay well clear of the float32 wire's own
6e-8 resolution or a settled camera would rewrite the URL forever. Its
tests pin the behaviour at five vantages spanning ten orders of magnitude,
which is the property that matters — not the value.
