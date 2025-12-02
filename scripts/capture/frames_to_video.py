#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image


def validate_frames(input_dir: Path, prefix: str):
    """
    Ensure we have at least one frame and that resolutions are consistent.
    Returns (first_frame_path, width, height).
    """
    files = sorted(input_dir.glob(f"{prefix}_*.png"))
    if not files:
        print(f"No frames found matching {prefix}_*.png in {input_dir}", file=sys.stderr)
        sys.exit(1)

    first = files[0]
    w, h = Image.open(first).size

    # Optional: sanity check a few frames to ensure size consistency
    for f in files[1:20]:
        fw, fh = Image.open(f).size
        if (fw, fh) != (w, h):
            print(
                f"Warning: frame {f.name} has different size ({fw}x{fh}) "
                f"than first frame ({w}x{h}). This may confuse ffmpeg.",
                file=sys.stderr,
            )
            break

    return first, w, h


def main():
    parser = argparse.ArgumentParser(
        description="Turn a sequence of PNG frames into an MP4 video using ffmpeg."
    )
    parser.add_argument(
        "--input-dir",
        type=str,
        required=True,
        help="Directory containing frame PNGs.",
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="frame",
        help="Filename prefix before the 5-digit index (default: frame).",
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=30.0,
        help="Video framerate (default: 30).",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=18,
        help="ffmpeg CRF quality (lower = better; 18–23 is a good range, default: 18).",
    )
    parser.add_argument(
        "--start-number",
        type=int,
        default=0,
        help="Index of the first frame (default: 0, matching prefix_00000.png).",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="Output video filename, e.g. bad_apple_roomA.mp4",
    )

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.is_dir():
        print(f"{input_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    # Sanity check frames & resolution
    first_frame, w, h = validate_frames(input_dir, args.prefix)
    print(f"Found frames like {first_frame.name} with resolution {w}x{h}")

    # Build ffmpeg input pattern
    # e.g. /path/to/frames/roomA_%05d.png
    pattern = os.path.join(str(input_dir), f"{args.prefix}_%05d.png")

    # Build ffmpeg command
    # -framerate: how fast to read input frames
    # -start_number: first index (0 for prefix_00000.png)
    # -c:v libx264: H.264 encoder
    # -pix_fmt yuv420p: widely compatible pixel format
    # -crf: quality (lower is better, 18–23 typical)
    cmd = [
        "ffmpeg",
        "-y",  # overwrite output without asking
        "-framerate",
        str(args.fps),
        "-start_number",
        str(args.start_number),
        "-i",
        pattern,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        str(args.crf),
        args.output,
    ]

    print("Running:", " ".join(cmd))
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        print("ffmpeg not found. Make sure it is installed and on your PATH.", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"ffmpeg failed with exit code {e.returncode}", file=sys.stderr)
        sys.exit(e.returncode)

    print(f"Done! Wrote {args.output}")


if __name__ == "__main__":
    main()
