#!/usr/bin/env python3
"""Convert one legally obtained ENC S-57 base cell (.000) to normalized GeoJSON.

Dependencies: GDAL command-line ogr2ogr (QGIS/OSGeo4W or gdal-bin).
The original .001, .002, ... update files must remain alongside the base.
No unlicensed downloads or automatic ENC authentication are performed.

Usage:
    python tools/enc_to_geojson.py US5XX000.000 -o inputs/derived/coastal-enc.geojson
    python tools/enc_to_geojson.py US5XX000.000 -o cell.geojson --bbox -72,40,-71,41

The resulting GeoJSON can be imported in the Coastal Hydrography panel.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ENC_LAYERS = ("SOUNDG", "DEPCNT", "DEPARE", "DRGARE", "M_QUAL",
              "COALNE", "WRECKS", "OBSTRN", "UNSARE", "M_COVR", "RESARE", "ACHARE", "ACHBRT", "UWTROC",
              "CBLARE", "DMPGRD", "DWRTPT", "FAIRWY", "ICNARE", "ISTZNE",
              "MARCUL", "MIPARE", "OSPARE", "PIPARE", "PRCARE", "SPLARE",
              "SUBTLN", "TESARE", "TSSCRS", "TSSLPT", "TSSRON")
MAX_FEATURES = 50000


def parse_bbox(text: str | None) -> tuple[float, float, float, float] | None:
    if text is None:
        return None
    try:
        bbox = tuple(float(x.strip()) for x in text.split(","))
    except ValueError as exc:
        raise ValueError("Expected --bbox west,south,east,north") from exc
    if len(bbox) != 4:
        raise ValueError("Expected --bbox west,south,east,north")
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("Invalid --bbox coordinates")
    return bbox


def ogr_command(source: Path, target: Path, layer: str,
                bbox: tuple[float, float, float, float] | None) -> list[str]:
    if layer not in ENC_LAYERS:
        raise ValueError(f"Unsupported ENC class: {layer}")
    cmd = ["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326",
           "-oo", "UPDATES=APPLY", "-oo", "SPLIT_MULTIPOINT=ON",
           "-oo", "ADD_SOUNDG_DEPTH=ON", "-oo", "LNAM_REFS=ON"]
    if bbox:
        cmd += ["-spat", *(str(x) for x in bbox)]
    cmd += [str(target), str(source), layer]
    return cmd


def convert(source: Path, output: Path, bbox=None, max_features=MAX_FEATURES):
    source = source.resolve()
    if source.suffix != ".000" or not source.is_file():
        raise ValueError("Provide the extracted ENC S-57 base file with suffix .000")
    if shutil.which("ogr2ogr") is None:
        raise RuntimeError("ogr2ogr is unavailable: install GDAL (gdal-bin / QGIS OSGeo Shell)")
    if output.resolve() == source:
        raise ValueError("Output must not replace the ENC source file")
    records = []
    with tempfile.TemporaryDirectory(prefix="enc_s57_") as tmp:
        for layer in ENC_LAYERS:
            tmp_out = Path(tmp) / f"{layer}.geojson"
            run = subprocess.run(ogr_command(source, tmp_out, layer, bbox),
                                 capture_output=True, text=True, timeout=120,
                                 check=False)
            if run.returncode != 0:
                msg = (run.stderr + " " + run.stdout).lower()
                if ("not found" in msg or "does not exist" in msg) and "layer" in msg:
                    continue  # optional chart object class not in this cell
                raise RuntimeError(f"GDAL {layer} failed: {run.stderr.strip()[:350]}")
            if not tmp_out.is_file():
                continue
            collection = json.loads(tmp_out.read_text(encoding="utf-8"))
            if collection.get("type") != "FeatureCollection":
                raise RuntimeError(f"Invalid GDAL GeoJSON: {layer}")
            for feature in collection.get("features", []):
                if len(records) >= max_features:
                    raise RuntimeError("Exceeded max objects; reduce --bbox or ENC cell")
                if feature.get("type") != "Feature":
                    continue
                feature.setdefault("properties", {})
                feature["properties"].update({
                    "_s57_layer": layer,
                    "_source_cell": source.stem,
                    "_source_type": "ENC_S57",
                    "_source_note": "Chart objects, not a measured bathymetric DTM",
                })
                records.append(feature)
    if not records:
        raise RuntimeError("No extractable ENC objects found; check cell, updates and bbox")
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {"type": "FeatureCollection", "features": records,
               "metadata": {
                   "source_file": source.name, "source_type": "S57_ENC",
                   "updates_policy": "GDAL_APPLY_FROM_ADJACENT_FILES",
                   "horizontal_crs": "EPSG:4326",
                   "vertical_datum": "REQUIRES_CHART_METADATA_VERIFICATION",
                   "license": "CHECK_CHART_PROVIDER_TERMS",
                   "navigation_approved": False,
               }}
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                      + "\n", encoding="utf-8")
    return len(records)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="S-57 ENC .000 base file; keep .001 updates nearby")
    parser.add_argument("--output", "-o", type=Path, required=True)
    parser.add_argument("--bbox", type=str, default=None, help="west,south,east,north (EPSG:4326)")
    parser.add_argument("--max-features", type=int, default=MAX_FEATURES)
    args = parser.parse_args(argv)
    try:
        if args.max_features < 1 or args.max_features > MAX_FEATURES:
            raise ValueError(f"max features must be 1..{MAX_FEATURES}")
        count = convert(args.source, args.output, parse_bbox(args.bbox),
                        max_features=args.max_features)
        print(f"Wrote {count} hydrographic objects to {args.output}")
        print("Vertical datum, chart edition, survey age and quality still require verification.")
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"ENC import error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
