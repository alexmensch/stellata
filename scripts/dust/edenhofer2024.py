"""The Edenhofer 2024 dust map as two pulled datasets: each variant's identity,
the committed file recording it, and the read every bake makes of it. See
README.md#the-edenhofer-2024-pulls."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
ZENODO_RECORD = "8187943"
DOI = "10.5281/zenodo.8187943"
SERVICE = "zenodo.org"
DUSTMAPS_SUBDIR = "edenhofer_2023"
_HASH_CHUNK_BYTES = 1 << 22

VARIANTS: dict[str, dict[str, str]] = {
    "main": {
        "flavor": "main",
        "file": "mean_and_std_healpix.fits",
        "md5": "10c823a5fcf81b47b6e15530bcdf54dc",
    },
    "2kpc": {
        "flavor": "less_data_but_2kpc",
        "file": "validation_with_less_data_but_2kpc_mean_and_std_healpix.fits",
        "md5": "0826b2f4cdfccad69bdc5e2d85bb4c54",
    },
}

FLAVOR_VARIANT = {spec["flavor"]: variant for variant, spec in VARIANTS.items()}


def identity(variant: str) -> dict[str, Any]:
    return {
        "dataset": "Edenhofer et al. 2024, 3D dust map (dustmaps edenhofer2023)",
        "doi": DOI,
        "variant": variant,
        **VARIANTS[variant],
    }


def identity_path(variant: str) -> Path:
    return REPO_ROOT / "data" / "dust" / f"edenhofer2024-{variant}.json"


def command(variant: str) -> str:
    return f"pnpm run refresh:edenhofer2024-{variant}"


def require(flavor: str) -> dict[str, Any]:
    """The committed identity of the dataset a bake reads for `flavor`."""
    variant = FLAVOR_VARIANT[flavor]
    path = identity_path(variant)
    if not path.exists():
        sys.exit(f"{path.relative_to(REPO_ROOT)} missing — run `{command(variant)}` first.")
    recorded = json.loads(path.read_text())
    if recorded != identity(variant):
        sys.exit(
            f"{path.relative_to(REPO_ROOT)} names a different dataset than "
            f"this code reads — run `{command(variant)}`."
        )
    return recorded


def describe(variant: str) -> dict[str, Any]:
    return {
        "query": json.dumps(identity(variant), sort_keys=True),
        "services": [SERVICE],
        "release": f"Zenodo record {ZENODO_RECORD}",
    }


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as f:
        while chunk := f.read(_HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def pull(variant: str) -> None:
    """Download the variant into dustmaps' data directory, check its md5 is
    the identity's, then write the identity file."""
    sys.path.insert(0, str(REPO_ROOT))
    import dustmaps.edenhofer2023
    from dustmaps.std_paths import data_dir

    from scripts.util.build_stamp import report_service

    spec = VARIANTS[variant]
    dustmaps.edenhofer2023.fetch(fetch_2kpc=variant == "2kpc")
    report_service(SERVICE)
    downloaded = Path(data_dir()) / DUSTMAPS_SUBDIR / spec["file"]
    if _md5(downloaded) != spec["md5"]:
        sys.exit(f"{downloaded} is not md5 {spec['md5']}: dustmaps fetched another dataset than VARIANTS names.")
    out = identity_path(variant)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(identity(variant), indent=2, sort_keys=True) + "\n")
    tmp.replace(out)
    print(f"wrote {out.relative_to(REPO_ROOT)}")


def main(variant: str) -> None:
    if sys.argv[1:] == ["--describe"]:
        print(json.dumps(describe(variant)))
        return
    pull(variant)
