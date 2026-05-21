"""Reusable SIMBAD-pull plumbing.

Sibling-module decomposition modelled on ``scripts/binaries``: an
orchestration shell (e.g. ``refresh-simbad-spectral.py``) declares the
column set + input set for a particular pull and calls into the modules
here for the SIMBAD ADQL and TSV mechanics. Future SIMBAD pulls (radial
velocity, photometry, alternate cross-IDs, …) reuse every file here.

Files
-----
specs.py    ColumnSpec / IdentLookup dataclasses + the basic-table
            spec catalogue (sp_type, sp_qual, otype, …).
inputs.py   InputSource iterators — read AT-HYG / WDS xids and yield
            the identifier triples the resolver consumes.
query.py    ADQL builders + batched executors parameterised on
            ColumnSpec / IdentLookup lists.
tsv.py      TSV writer wrapper that derives the header from a
            ColumnSpec list and `coerce_masked`s every cell.
"""
