# ORB on the wire

How a share link carries the attitude instrument's ORB frame, the orbit lock
over it, and a camera pose held relative to the orbit. The codec stays one
level up — bits 27–29 in `FIELDS_V4`, `wirePose`, `seatedPose` and
`restoreOrbitFrame`, all in `../url-state.ts` — and this README is the
authority on those fields; `../README.md` owns the rest of the wire format.

## Files

```
orbit-pose-pure.ts (+ test)  A pose's camera offset from its pivot, and its
                             up, carried between ICRS and a reference
                             frame's own components.
```

## ORB and the orbit lock

**ORB is not a `coordSphere` value.** The sky frames (galactic / ecliptic /
equatorial) are what that field carries; ORB — the focused object's own
orbital plane — and the orbit lock over it are held by the attitude
instrument itself (`../../../attitude/orbit-frame/README.md`). So a view with
ORB armed used to encode whichever sky frame was selected *before* ORB was
picked, and the lock encoded nothing at all: the link came back reading
against the wrong datum, with the camera no longer riding the orbit.

Both ride **zero-payload presence bits** — 27 (ORB armed) and 28 (lock
engaged) — because each is reconstructible from the focus the blob already
carries. The flags byte is full, so this is the [Adding a field](../README.md#adding-a-field) route
rather than a flag bit. Bit 28 opens the LEB128 mask's fifth 7-bit group,
which is the lock's whole cost.

They reach the instrument through `OrbitFramePort`
(`../../../attitude/attitude-pure.ts`), installed by the instrument onto the
shell — the codec talks to `Stellata`, and this is state no controller owns.
The same port answers `orbitFrame()`, ORB for the current focus at the
current `t`, which is what [An orbit-relative pose](#an-orbit-relative-pose) converts through.

**Being on the wire is not enough: a write has to be triggered too.** The
writer wakes on a `'state'` event or on a detected pose change, and these two
are the only URL fields that are neither `FilterState` (whose every mutation
emits `'state'`) nor a pose — arming ORB writes an instrument-local variable,
and engaging the lock moves nothing a still camera would show. So the
instrument announces them itself, through
`Stellata.notifyOrbitFrameChanged()`, on any change to either
([The lock](../../../attitude/orbit-frame/README.md#the-lock)). Without that the bits
reached the address bar only when some unrelated change happened to write it
afterwards, which is why the arm survived a refresh and the lock — the last
thing a user touches — did not.

**A restore lands LAST in `applyDecodedView`, and that is the field's whole
difficulty.** Three of the steps before it disarm ORB on their way past: the
instrument drops it on a focus change, on a `coordSphere` change, and with
the camera mode. A restore anywhere earlier is silently undone by a later
step of the same function, and lands unlocked. It runs again inside the
deferred-sid focus callback for the one case that settles after
`applyDecodedView` returns, so `restore` is idempotent.

**The blob is a request, not an instruction.** `restore` re-applies the
receiver's own `orbitLockShowing`, so a link asking for a lock this focus
cannot carry lands armed-but-unlocked, exactly as the gesture would. And an
absent bit is a positive statement — a sky-frame link disarms an ORB the
receiving session was already holding rather than leaving it standing.

The REF and TGT datums stay off the wire: both are snapshots of an attitude
rather than properties of the focus, so they need real payload and a separate
decision about whether a captured datum means anything to a receiver.

## An orbit-relative pose

**While the lock rides, `cam` and `up` go on the wire as ORB components**,
flagged by zero-payload bit 29, which is set only together with 28. The lock
promises an orientation held against the orbit, so a star-fixed (ICRS) pose
lands on whatever orbit-relative view the open date happens to produce — the
Sun sweeps through an Earth view once a year, and Luna's frame turns ~13° a
day. Storing the pose in ORB stores the invariant itself: the receiver rebuilds
ORB at its own `getT()` and converts back, so no epoch rides the wire and the
cost is no bytes at all, since 28 already opened the mask group.

**Only `cam − tgt` is rotated.** The ride carries the camera round
`controls.target`, so the wire does the same: `cam` becomes `tgt` plus the
offset's ORB components, `tgt` stays anchored ICRS, and `up` is ORB
components. `|cam − tgt|` survives, which keeps every scale-relative test in
`../pose-change-pure.ts` — the move threshold and the default elision — true
of the rotated pose unchanged.

**Level means level on ORB.** A bit-29 link omits `up` when the view is level
on the orbit pole — what `L` then `Shift`+`L` leaves, and what the ride then
holds — and `viewPose` fills the slot with +z, the pole in ORB's own
components.

**Both writers read `wirePose`**, so the change detector compares ORB
components too: the ride alone never reads as a camera move, and a still
locked view stays one URL however long it rides.

**Bit 28 alone keeps its meaning.** A link shared before bit 29 carries a
star-fixed `cam` and decodes exactly as it always did; the golden test in
`../url-state.test.ts` pins one. Its receiver engages the lock over the pose it
seated, so the next write re-encodes it with bit 29.

**The conversion runs after the focus lands**, because ORB is a property of
the focus: `applyDecodedView` converts once a synchronous focus has applied,
and the deferred-focus callback converts in its re-seat
([A focus that resolves after the pose](../README.md#a-focus-that-resolves-after-the-pose)).
A focus with no ORB behind it seats the components as ICRS — nothing is
drawn to hold the pose against, and `restore` refuses the lock there too.
