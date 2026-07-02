#!/usr/bin/env python3
import argparse
import re
import sys
from pathlib import Path

from PIL import Image


def load_indexed_frames(directory: Path, prefix: str):
    """
    Return list of (index, Path) for files like prefix_00000.png in given directory.
    """
    pattern = re.compile(rf"^{re.escape(prefix)}_(\d+)\.png$")
    frames = []
    for p in directory.glob(f"{prefix}_*.png"):
        m = pattern.match(p.name)
        if not m:
            continue
        idx = int(m.group(1))
        frames.append((idx, p))
    frames.sort(key=lambda t: t[0])
    return frames


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Merge two frame sequences (base + overlay) into a single sequence. "
            "Frames are matched by index (e.g. XXXX in prefix_XXXXX.png)."
        )
    )
    parser.add_argument(
        "--base-dir",
        required=True,
        help="Directory containing base frames.",
    )
    parser.add_argument(
        "--overlay-dir",
        required=True,
        help="Directory containing overlay frames.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to write merged frames into.",
    )
    parser.add_argument(
        "--base-prefix",
        default="frame",
        help="Base filename prefix before index (default: frame).",
    )
    parser.add_argument(
        "--overlay-prefix",
        default="frame",
        help="Overlay filename prefix before index (default: frame).",
    )
    parser.add_argument(
        "--output-prefix",
        default="merged",
        help="Output filename prefix (default: merged).",
    )
    parser.add_argument(
        "--offset-x",
        type=int,
        default=0,
        help="X offset (pixels) where overlay top-left is placed on the canvas.",
    )
    parser.add_argument(
        "--offset-y",
        type=int,
        default=0,
        help="Y offset (pixels) where overlay top-left is placed on the canvas.",
    )
    parser.add_argument(
        "--canvas-width",
        type=int,
        default=0,
        help="Canvas width (pixels). If 0, auto-fit base + overlay.",
    )
    parser.add_argument(
        "--canvas-height",
        type=int,
        default=0,
        help="Canvas height (pixels). If 0, auto-fit base + overlay.",
    )
    parser.add_argument(
        "--bg-color",
        default="#000000",
        help="Background color for canvas (default: black).",
    )

    args = parser.parse_args()

    base_dir = Path(args.base_dir)
    overlay_dir = Path(args.overlay_dir)
    output_dir = Path(args.output_dir)

    if not base_dir.is_dir():
        print(f"{base_dir} is not a directory", file=sys.stderr)
        sys.exit(1)
    if not overlay_dir.is_dir():
        print(f"{overlay_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    base_frames = load_indexed_frames(base_dir, args.base_prefix)
    overlay_frames = load_indexed_frames(overlay_dir, args.overlay_prefix)

    if not base_frames:
        print("No base frames found.", file=sys.stderr)
        sys.exit(1)
    if not overlay_frames:
        print("No overlay frames found.", file=sys.stderr)
        sys.exit(1)

    overlay_by_idx = {idx: path for idx, path in overlay_frames}

    # Get base frame size
    first_base_img = Image.open(base_frames[0][1]).convert("RGB")
    base_w, base_h = first_base_img.size
    first_base_img.close()

    print(
        f"Base frames: {len(base_frames)} (size {base_w}x{base_h}), "
        f"overlay frames: {len(overlay_frames)}"
    )

    for idx, base_path in base_frames:
        with Image.open(base_path).convert("RGB") as base_img:
            base_w, base_h = base_img.size

            overlay_img = None
            if idx in overlay_by_idx:
                overlay_img = Image.open(overlay_by_idx[idx]).convert("RGB")
                overlay_w, overlay_h = overlay_img.size
            else:
                overlay_w = overlay_h = 0

            # Determine canvas size
            if args.canvas_width > 0 and args.canvas_height > 0:
                canvas_w = args.canvas_width
                canvas_h = args.canvas_height
            else:
                # Auto-fit: ensure both base (0,0) and overlay (offset) fit
                max_w = base_w
                max_h = base_h
                if overlay_img is not None:
                    max_w = max(max_w, args.offset_x + overlay_w)
                    max_h = max(max_h, args.offset_y + overlay_h)
                canvas_w, canvas_h = max_w, max_h

            canvas = Image.new("RGB", (canvas_w, canvas_h), color=args.bg_color)
            # Paste base at (0,0)
            canvas.paste(base_img, (0, 0))

            # Paste overlay if present
            if overlay_img is not None:
                canvas.paste(overlay_img, (args.offset_x, args.offset_y))
                overlay_img.close()

            out_name = f"{args.output_prefix}_{idx:05d}.png"
            out_path = output_dir / out_name
            canvas.save(out_path)

    print("Done.")


if __name__ == "__main__":
    main()
