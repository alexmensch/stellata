# Camera step — which controller moves the camera this tick

`CameraStep.advance(nowMs)` runs once per `requestAnimationFrame` tick,
above the render gate, from `stellata.ts` `animate()`. Exactly one
controller moves the camera per tick, chosen in a fixed priority order, and
the step answers whether that controller was a transition.

## Files

- `camera-step.ts` (+ test) — `CameraStep`: the dispatch, the two roll
  adoptions around it, and the `TrackballSettle` it constructs, attaches to
  the canvas and disposes. The shell builds it after every controller it
  reads.

## The dispatch

| Priority | Condition | Runs | Verdict |
| :-: | --- | --- | --- |
| 1 | `warp.isActive()` | `warp.tick` | animating |
| 2 | `aim.isActive()` | `aim.tick` | animating |
| 3 | `focus.isFocusLerpActive()` | `focus.tick` | animating |
| 4 | `aim.isObserveAimActive()` | `aim.tickObserve`, then the look pin | animating |
| 5 | `observe.isAnyActive()` | `observe.tick` | animating |
| 6 | camera mode is observe | look-around `update`, then the look pin | steady |
| 7 | otherwise (navigate) | settle `capture` → `controls.update()` → settle `tick` | steady |

[Camera-activity predicates](../README.md#camera-activity-predicates)
carries which animation sources exist and who reads which union of them.

The look pin re-derives only after a rotation
([The serialised look pin](../observe/README.md#the-serialised-look-pin)), so
the two branches that rotate an observe camera run it and nothing else
does. The settle brackets `controls.update()` because that call re-derives
the pose it measures against
([Derived-pose settle floor](../controls/input/README.md#derived-pose-settle-floor)).

## The verdict

`advance` returns true on branches 1–5 and false on 6–7. It is the render
gate's transition input, **not re-derived anywhere**: a sixth animation
source added as a new branch is animating by default, because only the two
steady-state branches return false. Asking the five predicates again
beside the dispatch would be a second definition of "camera busy" for a new
source to drift out of ([The decision](../../render-gate/README.md#the-decision-in-priority-order)).

## Roll

Two adoptions bracket the dispatch, one per roll authority
([Roll authority](../controls/input/README.md#roll-authority)): in observe,
`camera.up` follows the quaternion **before** the dispatch; in navigate,
`up` is re-derived **after** an animating branch
([The perpendicular invariant](../controls/input/README.md#the-perpendicular-invariant)),
and never on steady navigate, where TrackballControls transports it.
