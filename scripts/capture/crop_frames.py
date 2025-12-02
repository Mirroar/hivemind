#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

from PIL import Image


def parse_crop_box(s: str):
    """
    Parse crop box from 'left,top,width,height'.
    """
    try:
        left, top, width, height = map(int, s.split(","))
    except Exception:
        raise argparse.ArgumentTypeError(
            "Crop box must be 'left,top,width,height', e.g. '100,200,800,600'"
        )

    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("Width and height must be positive")

    right = left + width
    bottom = top + height
    return left, top, right, bottom


def main():
    parser = argparse.ArgumentParser(
        description="Crop frame PNGs in a folder and write them to another folder."
    )
    parser.add_argument(
        "--input-dir",
        required=True,
        help="Directory containing original frame PNGs.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to write cropped frames into (will be created if needed).",
    )
    parser.add_argument(
        "--prefix",
        default="frame",
        help="Filename prefix before the numeric index (default: frame).",
    )
    parser.add_argument(
        "--crop",
        required=True,
        type=parse_crop_box,
        help="Crop region as 'left,top,width,height' in pixels.",
    )

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    prefix = args.prefix
    left, top, right, bottom = args.crop

    if not input_dir.is_dir():
        print(f"{input_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(input_dir.glob(f"{prefix}_*.png"))
    if not files:
        print(
            f"No files matching {prefix}_*.png found in {input_dir}",
            file=sys.stderr,
        )
        sys.exit(1)

    print(
        f"Cropping {len(files)} frames from {input_dir} to {output_dir} "
        f"with box ({left},{top})-({right},{bottom})"
    )

    for path in files:
        with Image.open(path) as im:
            w, h = im.size
            if right > w or bottom > h:
                print(
                    f"Error: crop box {left, top, right, bottom} "
                    f"exceeds image bounds {w}x{h} in {path.name}",
                    file=sys.stderr,
                )
                sys.exit(1)

            cropped = im.crop((left, top, right, bottom))
            out_path = output_dir / path.name
            cropped.save(out_path)

    print("Done.")


if __name__ == "__main__":
    main()
