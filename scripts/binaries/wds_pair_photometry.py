#!/usr/bin/env python3
"""A WDS pair row's magnitudes: its own, else the MSC's, and their difference."""

from __future__ import annotations

from .msc_map import MscLookup
from .parsers import WdsPair


def wds_dmag(mag_pri: float | None, mag_sec: float | None) -> float | None:
    """``mag_sec − mag_pri`` from a WDS pair row, or ``None`` when
    either magnitude is missing. Survives intact through the V/absolute-
    mag transform — both components sit at the same distance, so an
    apparent Δmag equals the absolute Δmag. Companion promotion uses
    this to impute the secondary's absmag when the row inherits the
    primary's AT-HYG absmag."""
    if mag_pri is None or mag_sec is None:
        return None
    return mag_sec - mag_pri


def pair_magnitudes(
    pair: WdsPair, p_tok: str, s_tok: str, msc: MscLookup | None,
) -> tuple[float | None, float | None]:
    """The pair row's ``(mag_pri, mag_sec)``: WDS's own, else the MSC's
    pair-side V when WDS prints neither."""
    if pair.mag_pri is None and pair.mag_sec is None and msc is not None:
        filled = msc.pair_mags.get((pair.wds_id, (p_tok, s_tok)))
        if filled is not None:
            return filled
    return pair.mag_pri, pair.mag_sec
