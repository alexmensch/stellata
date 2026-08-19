#!/usr/bin/env python3
"""Per-body texture size ladder: which widths a body ships, given the width
its frozen master actually has (contract in data/textures/README.md § Ladder)."""

# Power-of-two rungs the runtime selects between. 1024 is the floor a
# distant body holds; 8192 is what a 5K display asks for at the camera
# floor, where minOrbitDistForPlanet puts every body across 90% of the
# viewport's minor axis and an equirect map spends W/2 texels on the disc.
RUNGS = (1024, 2048, 4096, 8192)

# Widest map the pipeline can use, so the widest a frozen master is worth
# storing. A master is reduced to this on the way into data/textures/src/
# and carries no headroom past it — raising it is a re-pull, not a resize.
MASTER_W = RUNGS[-1]


def rungs_for(native_w: int) -> tuple[int, ...]:
    """The rungs a master `native_w` wide can fill, top rung last.

    Two rules, and the top rung is where they meet: never upscale, and never
    discard detail the master already has. So a body whose master is not a
    power of two ships that master's own width as its top rung — Venus stops
    at 1800 and Saturn at 2880 rather than falling back to 1024 and 2048.
    Those are the cloud and haze bodies, which have no high-frequency detail
    to photograph; a soft Saturn is closer to correct than a sharp one.
    """
    top = min(native_w, MASTER_W)
    return tuple(r for r in RUNGS if r < top) + (top,)
