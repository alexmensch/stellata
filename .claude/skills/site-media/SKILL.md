---
name: site-media
description: >
  Reformat a screen capture or still into a marketing-site media slot — the
  16:9 target, the H.264 encode, the poster frame, and the measure-first
  procedure that decides crop vs pad vs hand-it-back. Use whenever a clip or
  image lands in public/site/, when a sight slot needs filling, when asked to
  reformat, re-encode, crop, resize, compress or optimise site media, or when
  a `debug.capture()` take has to become a shippable asset.
---

# Site media — captures into sight slots

[Sights](/src/site/README.md#sights--the-media-and-the-link-it-carries) owns the contract and every *why* behind it:
the encode settings, CRF 17 rather than the usual 21, no `loop`, the
five-second ceiling, the poster being the clip's last frame. Read it once
per session before encoding. This file is the **procedure** — what to
measure before touching a file, and the commands that follow.

**Consistency is the point.** These clips sit in one row on one page. A
sight at 15 fps beside one at 60, or one letterboxed beside one full-bleed,
reads as a mistake before a viewer can name which. So prefer the settings
here over a per-file judgement that looks better in isolation, and when a
file genuinely cannot meet them, say so rather than quietly special-casing
it — [Hand it back](#hand-it-back).

## The target

| | clips | stills |
|---|---|---|
| dimensions | 1920×1080 | 2400×1350 |
| aspect | 16:9, always | 16:9, always |
| codec | H.264 High, `yuv420p` | JPEG |
| rate | 30 fps | — |
| runtime | **under** 5 s | — |
| audio | none | — |
| poster | `<name>.jpg`, the clip's **last** frame | — |

Shoot at 2400 px wide or more, **in a 16:9 window**. A 16:9 source needs no
crop decision at all, which is the cheapest way to make all of this go away.

## Measure before you crop — never decide from one frame

A capture's nominal frame rate is the container's, not what was delivered,
and a subject that fits the frame in the frame you happened to look at may
not fit in any other. Two measurements, both cheap:

```bash
# Delivered frame rate. A screen capture drops frames; r_frame_rate lies.
n=$(ffprobe -v error -select_streams v:0 -count_frames \
      -show_entries stream=nb_read_frames -of csv=p=0 in.mov)
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 in.mov)
echo "$n frames / ${d}s"

# Content bounds across EVERY frame, not the last one.
ffmpeg -v info -i in.mov -vf "cropdetect=limit=20:round=2:reset=1" -f null - 2>&1 \
  | grep -o 'x1:[0-9-]* x2:[0-9-]* y1:[0-9-]* y2:[0-9-]*'
```

Take the widest extent over the whole run. A pulsating star is the worked
example: its disc is largest at maximum radius, so a crop fitted to the
settled frame slices the limb for part of the cycle and not the rest, which
reads as a rendering fault rather than a framing one.

`cropdetect` only answers where the background is genuinely black. On a
starfield it reports the full frame, correctly — there judge by where the
*subject* sits, by extracting a frame and looking at it.

Then: content height needed, against `width × 9/16` available.

- **Fits** → crop, centred, even offsets.
- **Does not fit** → **pad, don't crop.** These scenes sit on black, so
  bars are invisible and nothing is lost. Cropping a subject that fills the
  frame is the one irreversible choice here.
- **Source is clipped already, or below ~24 fps** → [Hand it back](#hand-it-back).

## Commands

Crop to 16:9 and encode. `-t` trims the tail; a `debug.capture()` take eases
to a stop, so its last fraction of a second is motionless and free to lose.

```bash
ffmpeg -y -i in.mov -t 4.95 \
  -vf "crop=<w>:<h>:<x>:<y>,scale=1920:1080:flags=lanczos" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 17 -preset slow \
  -an -movflags +faststart -r 30 out.mp4
```

Pad instead of cropping — width for 16:9 is `round(height × 16/9)`, rounded
up to even, and the offset is half the difference:

```bash
-vf "pad=<padw>:<h>:<offx>:0:black,scale=1920:1080:flags=lanczos"
```

The poster, which must come from the **encoded** file so the still and the
frame the clip settles on agree:

```bash
ffmpeg -y -sseof -0.1 -i out.mp4 -update 1 -frames:v 1 -q:v 2 out.jpg
```

A still, where the source may carry alpha and so needs compositing onto
black rather than a bare pixel-format conversion:

```bash
ffmpeg -y -f lavfi -i color=c=black:s=<padw>x<h> -i in.png \
  -filter_complex "[0][1]overlay=<offx>:0:shortest=1,scale=2400:1350:flags=lanczos,format=yuv420p" \
  -frames:v 1 -q:v 3 out.jpg
```

Verify before committing: dimensions, `profile=High`, `pix_fmt=yuv420p`,
duration under 5 s, and no audio stream.

## Expect a dense starfield to be large

CRF 17 on a starfield in motion runs several times the cost of a smooth
gradient — thousands of moving point-stars defeat temporal prediction, and
relaxing to CRF 23 only halves it while crushing faint stars into flicker.
A sight clip several times the hero's size is the content, not a mistake.
Report the number rather than quietly raising CRF: the setting is pinned in
[Sights](/src/site/README.md#sights--the-media-and-the-link-it-carries) for a reason, and relaxing it is the user's
call.

## Hand it back

Some inputs cannot be rescued by re-encoding, and re-shooting is cheap now
that `debug.capture()` makes a take repeatable
(`src/client/debug/capture/README.md`). Say which file, which measurement,
and what to change:

- **Delivered frame rate below ~24 fps.** Stutter is baked into the source.
- **The subject is already clipped by the source frame.**
- **A crop that would cut the subject, where padding would shrink it below
  the point the copy is making** — a "fills the entire screen" claim beside
  a disc floating in bars is worse than either.

## Keep this skill current — do this without being asked

**Edit this file in the same session, without asking**, whenever something
here is wrong or stale, you had to work out an undocumented fact about this
repo's media to get a file shipped, or — the trigger that gets skipped —
**the user corrected a media decision of yours.** A correction is a defect
in this file until proven otherwise: fix the asset, then ask what let you
get it wrong. If a rule was written down and still got violated, the
pickup point is what failed, and the fix is usually a different trigger
wording rather than a new paragraph.

Write the rule that catches the **class**, not a note about the incident;
the incident belongs in the commit message. Default to a pointer — restate
only what you must know *before* you would know to look it up. Verify
against the running tools or the repo before writing, keep the register
terse, do not duplicate [Sights](/src/site/README.md#sights--the-media-and-the-link-it-carries), and say in one line
what changed.
