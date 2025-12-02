#!/usr/bin/env python3
import argparse
import re
import shutil
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Renumber frame PNGs (prefix_XXXXX.png) into a new folder."
    )
    parser.add_argument(
        "--input-dir",
        required=True,
        help="Directory containing original frame PNGs.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to write renumbered frames into (must not be the same as input).",
    )
    parser.add_argument(
        "--prefix",
        default="frame",
        help="Input filename prefix before numeric index (default: frame).",
    )
    parser.add_argument(
        "--output-prefix",
        default=None,
        help="Output filename prefix (default: same as --prefix).",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=0,
        help="Starting index for new numbering (default: 0).",
    )
    parser.add_argument(
        "--zero-pad",
        type=int,
        default=5,
        help="Number of digits for zero padding (default: 5 -> 00000).",
    )

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    prefix = args.prefix
    out_prefix = args.output_prefix or prefix

    if not input_dir.is_dir():
        print(f"{input_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    if output_dir.resolve() == input_dir.resolve():
        print(
            "output-dir must be different from input-dir to avoid overwriting.",
            file=sys.stderr,
        )
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    pattern = re.compile(rf"^{re.escape(prefix)}_(\d+)\.png$")
    files = []

    for p in input_dir.glob(f"{prefix}_*.png"):
        m = pattern.match(p.name)
        if not m:
            continue
        idx = int(m.group(1))
        files.append((idx, p))

    if not files:
        print(
            f"No files matching {prefix}_#####.png found in {input_dir}",
            file=sys.stderr,
        )
        sys.exit(1)

    # Sort by original index
    files.sort(key=lambda t: t[0])

    print(
        f"Renumbering {len(files)} frames from {input_dir} to {output_dir} "
        f"starting at {args.start}"
    )

    new_idx = args.start
    for old_idx, path in files:
        new_name = f"{out_prefix}_{new_idx:0{args.zero_pad}d}.png"
        dest = output_dir / new_name
        shutil.copy2(path, dest)
        new_idx += 1

    print("Done.")


if __name__ == "__main__":
    main()
