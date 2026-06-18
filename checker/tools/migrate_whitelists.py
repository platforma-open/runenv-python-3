#!/usr/bin/env python3
"""Collapse per-variant whitelist files into one global file per platform.

Reads:   checker/whitelists/<variant>/<platform>.json   (current layout)
Writes:  checker/whitelists/<platform>.json             (new layout)

Each (wheel-pattern, module) tuple is a property of the wheel and platform,
not of the runenv variant that happens to include it. Several variants
duplicate the same entry today (72 of 235 keys), and each duplicate drifts
independently when wheel versions change. After this migration there is
one source of truth per platform.

When two variants disagree on the error substring for the same
(wheel-pattern, module), the shorter substring wins -- ``is_whitelisted``
does ``expected.lower() in actual.lower()``, so a shorter pattern matches a
strict superset of cases. The conflict is logged so it can be reviewed.

Run repeatedly; output is deterministic (sorted keys, stable choice on tie).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
WL_ROOT = REPO_ROOT / "checker" / "whitelists"


def read_per_variant() -> Dict[str, Dict[Tuple[str, str], List[Tuple[str, str]]]]:
    """Return {platform: {(wheel_pattern, module): [(error_substr, source_variant), ...]}}."""
    by_platform: Dict[str, Dict[Tuple[str, str], List[Tuple[str, str]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for variant_dir in sorted(WL_ROOT.iterdir()):
        if not variant_dir.is_dir():
            continue
        for f in sorted(variant_dir.glob("*.json")):
            platform = f.stem
            data = json.loads(f.read_text())
            for wheel_pattern, modules in data.items():
                for module, error in modules.items():
                    by_platform[platform][(wheel_pattern, module)].append(
                        (error, variant_dir.name)
                    )
    return by_platform


def merge(
    entries: List[Tuple[str, str]],
) -> Tuple[str, List[Tuple[str, str]]]:
    """Pick the canonical error substring + return any conflicts.

    Strategy: take the shortest (most permissive) substring. Stable on tie
    by alphabetic order of the substring (NOT the source variant -- variant
    order is irrelevant to the resulting file).
    """
    unique_errors = sorted({e for e, _ in entries}, key=lambda s: (len(s), s))
    canonical = unique_errors[0]
    conflicts: List[Tuple[str, str]] = []
    if len(unique_errors) > 1:
        for error, variant in entries:
            if error != canonical:
                conflicts.append((variant, error))
    return canonical, conflicts


def build_global(by_platform) -> Tuple[Dict[str, Dict[str, Dict[str, str]]], List[str]]:
    """Build {platform: {wheel_pattern: {module: error}}} + warnings list."""
    out: Dict[str, Dict[str, Dict[str, str]]] = {}
    warnings: List[str] = []
    for platform, keys in by_platform.items():
        wheel_map: Dict[str, Dict[str, str]] = defaultdict(dict)
        for (wheel_pattern, module), entries in keys.items():
            canonical, conflicts = merge(entries)
            wheel_map[wheel_pattern][module] = canonical
            if conflicts:
                msg = (
                    f"[{platform}] {wheel_pattern} / {module}: "
                    f"chose {canonical!r}; differing entries from "
                    + ", ".join(f"{v}({e!r})" for v, e in conflicts)
                )
                warnings.append(msg)
        # Sort wheel patterns and modules for stable output.
        out[platform] = {
            wheel: dict(sorted(mods.items()))
            for wheel, mods in sorted(wheel_map.items())
        }
    return out, warnings


def write_global(global_data: Dict[str, Dict[str, Dict[str, str]]]) -> List[Path]:
    paths: List[Path] = []
    for platform, data in sorted(global_data.items()):
        path = WL_ROOT / f"{platform}.json"
        path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n")
        paths.append(path)
    return paths


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be written; do not modify disk.",
    )
    args = parser.parse_args(argv)

    by_platform = read_per_variant()
    if not by_platform:
        print(f"No per-variant whitelists found under {WL_ROOT}", file=sys.stderr)
        return 1

    global_data, warnings = build_global(by_platform)
    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)

    if args.dry_run:
        print(json.dumps(global_data, indent=2, sort_keys=False))
        return 0

    paths = write_global(global_data)
    for p in paths:
        rel = p.relative_to(REPO_ROOT)
        n_wheels = len(json.loads(p.read_text()))
        n_modules = sum(len(m) for m in json.loads(p.read_text()).values())
        print(f"wrote {rel}: {n_wheels} wheel pattern(s), {n_modules} module(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
