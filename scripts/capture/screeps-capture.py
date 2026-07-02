#!/usr/bin/env python3
import argparse
import os
import sys
import time
from datetime import datetime

import mss
from PIL import Image, ImageChops, ImageStat, ImageDraw


def detect_scale(sct, monitor):
    """Detect HiDPI scale factor (1.0 on normal screens, ~2.0 on Retina)."""
    shot = sct.grab(monitor)
    shot_w, shot_h = shot.size

    mon_w = monitor["width"]
    mon_h = monitor["height"]

    # Avoid division by zero just in case
    if mon_w == 0 or mon_h == 0:
        return 1.0

    scale_x = shot_w / mon_w
    scale_y = shot_h / mon_h
    scale = (scale_x + scale_y) / 2.0

    if abs(scale_x - scale_y) > 0.01:
        print(
            f"Warning: non-uniform scale? scale_x={scale_x:.2f}, "
            f"scale_y={scale_y:.2f}",
            file=sys.stderr,
        )

    print(
        f"Detected scale factor: {scale:.2f} "
        f"(monitor={mon_w}x{mon_h}, shot={shot_w}x{shot_h})"
    )

    return max(scale, 1.0)


def parse_region(region_str: str):
    """
    Parse region in the form 'left,top,width,height'.
    These coordinates are RELATIVE to the chosen monitor's top-left.
    """
    try:
        left, top, width, height = map(int, region_str.split(","))
        return {"left": left, "top": top, "width": width, "height": height}
    except Exception:
        raise argparse.ArgumentTypeError(
            "Region must be in the form 'left,top,width,height', e.g. '100,200,80,40'"
        )


def ensure_output_dir(path: str):
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)


def next_frame_index(output_dir: str, prefix: str):
    """
    Find the next frame index by scanning existing files with the same prefix.
    Filenames are assumed to be like: prefix_00001.png
    """
    max_idx = -1
    for name in os.listdir(output_dir):
        if not name.startswith(prefix):
            continue
        base, ext = os.path.splitext(name)
        try:
            idx_str = base.split("_")[-1]
            idx = int(idx_str)
            if idx > max_idx:
                max_idx = idx
        except ValueError:
            continue
    return max_idx + 1


def grab_region(sct: mss.mss, region: dict) -> Image.Image:
    """
    Grab an absolute region (desktop coordinates).
    region = {left, top, width, height}
    """
    shot = sct.grab(region)
    img = Image.frombytes("RGB", shot.size, shot.rgb)
    return img


def grab_fullscreen(sct: mss.mss, monitor: dict) -> Image.Image:
    """
    Grab a full screenshot of the given monitor.
    monitor is one of sct.monitors[1..n]
    """
    shot = sct.grab(monitor)
    img = Image.frombytes("RGB", shot.size, shot.rgb)
    return img


def prepare_for_diff(img: Image.Image) -> Image.Image:
    """
    Downscale + grayscale to make diffing cheap and robust to tiny noise.
    """
    return img.convert("L").resize((32, 32), Image.BILINEAR)


def image_diff_score(img_a: Image.Image, img_b: Image.Image) -> float:
    """
    Return a scalar score of how different two images are (0 = identical).
    """
    a = prepare_for_diff(img_a)
    b = prepare_for_diff(img_b)
    diff = ImageChops.difference(a, b)
    stat = ImageStat.Stat(diff)
    # mean gray difference (0..255)
    return stat.mean[0]


def overlay_debug(img: Image.Image, watch_region_abs: dict, monitor: dict, scale: float):
    """
    Draw a 100px grid + the watched region rectangle onto the captured frame.

    img:     monitor screenshot (coordinates in *physical* pixels)
    watch_region_abs: absolute desktop coordinates of the watched region (logical)
    monitor: monitor dict from mss with left/top/width/height in logical coords
    scale:   HiDPI scale factor between logical and physical (1 on normal, 2 on Retina)
    """
    draw = ImageDraw.Draw(img)
    width, height = img.size

    # Logical coords -> relative to monitor (still logical)
    rel_left_log = watch_region_abs["left"] - monitor["left"]
    rel_top_log = watch_region_abs["top"] - monitor["top"]
    rel_right_log = rel_left_log + watch_region_abs["width"]
    rel_bottom_log = rel_top_log + watch_region_abs["height"]

    # Convert logical to physical pixels using scale factor
    rel_left = rel_left_log * scale
    rel_top = rel_top_log * scale
    rel_right = rel_right_log * scale
    rel_bottom = rel_bottom_log * scale

    # Draw watched region in red
    draw.rectangle(
        [rel_left, rel_top, rel_right, rel_bottom],
        outline="red",
        width=2,
    )

    # Draw 100px grid (in *physical* pixels) in green
    step = 100
    for x in range(0, width, step):
        draw.line([(x, 0), (x, height - 1)], fill="green", width=1)
    for y in range(0, height, step):
        draw.line([(0, y), (width - 1, y)], fill="green", width=1)

    # Tiny labels at intersections (optional)
    try:
        for x in range(0, width, step):
            for y in range(0, height, step):
                label = f"{x},{y}"
                draw.text((x + 2, y + 2), label, fill="white")
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(
        description="Capture Screeps frames when a watched region changes."
    )
    parser.add_argument(
        "--region",
        type=parse_region,
        required=True,
        help=(
            "Region RELATIVE to the chosen monitor as "
            "'left,top,width,height' (e.g. '100,200,80,40')."
        ),
    )
    parser.add_argument(
        "--monitor",
        type=int,
        default=1,
        help=(
            "Monitor index to use (1..N, as seen by mss). "
            "This is used for both polling and screenshots. Default: 1."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        required=True,
        help="Folder to write frames into.",
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="frame",
        help="Filename prefix for frames (default: frame).",
    )
    parser.add_argument(
        "--settle-ms",
        type=int,
        default=100,
        help="Extra delay after detecting a change before capturing (default: 100).",
    )
    parser.add_argument(
        "--poll-ms",
        type=int,
        default=50,
        help="How often to poll the watched region (default: 50).",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=8.0,
        help="Change threshold (0–255). Higher = less sensitive. (default: 8.0)",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Stop after this many frames (0 = unlimited).",
    )
    parser.add_argument(
        "--debug-overlay",
        action="store_true",
        help="Draw watched region + 100px grid onto saved frames.",
    )
    parser.add_argument(
        "--print-diff",
        action="store_true",
        help="Print diff score for each poll (for threshold tuning).",
    )

    args = parser.parse_args()

    output_dir = ensure_output_dir(args.output_dir)
    settle_s = args.settle_ms / 1000.0
    poll_s = args.poll_ms / 1000.0
    threshold = args.threshold
    max_frames = args.max_frames

    print("=== Screeps auto-capture started ===")

    with mss.mss() as sct:
        monitors = sct.monitors
        num_monitors = len(monitors) - 1  # monitors[0] = virtual, 1..N = real

        if num_monitors <= 0:
            print("No monitors found. Are you running in a GUI session?", file=sys.stderr)
            sys.exit(1)

        if args.monitor < 1 or args.monitor > num_monitors:
            print(
                f"Invalid monitor index {args.monitor}. "
                f"Available monitors: 1..{num_monitors}",
                file=sys.stderr,
            )
            sys.exit(1)

        monitor = monitors[args.monitor]
        scale = detect_scale(sct, monitor)

        print(
            f"Using monitor {args.monitor}: "
            f"{monitor['width']}x{monitor['height']} "
            f"at ({monitor['left']},{monitor['top']})"
        )

        # Convert region from monitor-relative coordinates to absolute desktop coords
        rel = args.region
        watch_region = {
            "left": monitor["left"] + rel["left"],
            "top": monitor["top"] + rel["top"],
            "width": rel["width"],
            "height": rel["height"],
        }

        print(
            f"Watching region (monitor-relative): {rel} "
            f"=> (absolute): {{'left': {watch_region['left']}, 'top': {watch_region['top']}, "
            f"'width': {watch_region['width']}, 'height': {watch_region['height']}}}"
        )

        print(f"Output dir     : {output_dir}")
        print(f"Filename prefix: {args.prefix}")
        print(f"Settle delay   : {args.settle_ms} ms")
        print(f"Poll interval  : {args.poll_ms} ms")
        print(f"Diff threshold : {threshold}")
        if max_frames > 0:
            print(f"Max frames     : {max_frames}")
        print(f"Debug overlay  : {args.debug_overlay}")
        print(f"Print diff     : {args.print_diff}")
        print("Press Ctrl+C to stop.\n")

        frame_idx = next_frame_index(output_dir, args.prefix)
        print(f"Starting from frame index: {frame_idx}")

        last_region_img = None
        pending_capture_at = None

        try:
            # Prime the baseline
            last_region_img = grab_region(sct, watch_region)

            while True:
                now = time.time()

                # Grab region and compare
                current_region = grab_region(sct, watch_region)

                if last_region_img is not None:
                    score = image_diff_score(current_region, last_region_img)
                    if args.print_diff:
                        print(f"diff={score:.2f}")

                    if pending_capture_at is None and score >= threshold:
                        pending_capture_at = now + settle_s
                        print(
                            f"[{datetime.now().isoformat(timespec='seconds')}] "
                            f"Change detected (score={score:.2f}). "
                            f"Scheduling capture in {args.settle_ms} ms."
                        )

                # Update baseline every poll so we don't re-trigger on the same transition
                last_region_img = current_region

                # Time to capture?
                if pending_capture_at is not None and now >= pending_capture_at:
                    pending_capture_at = None

                    full_img = grab_fullscreen(sct, monitor)

                    if args.debug_overlay:
                        overlay_debug(full_img, watch_region, monitor, scale)

                    filename = f"{args.prefix}_{frame_idx:05d}.png"
                    path = os.path.join(output_dir, filename)
                    full_img.save(path)
                    print(
                        f"[{datetime.now().isoformat(timespec='seconds')}] "
                        f"Saved frame {frame_idx} -> {path}"
                    )

                    frame_idx += 1
                    if max_frames > 0 and frame_idx >= max_frames:
                        print("Reached max_frames limit. Exiting.")
                        break

                time.sleep(poll_s)

        except KeyboardInterrupt:
            print("\nInterrupted by user, stopping capture.")
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
