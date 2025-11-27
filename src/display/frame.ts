// image-frame.ts
// Minimal pixel frame + budgeted applier for your BigScreen.
// Pixels: 0 = off (private), 1 = on (public).

import type { BigScreen } from 'display/screens';

export class PixelFrame {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array; // length = w*h, values 0 or 1

  constructor(w: number, h: number, data?: Uint8Array) {
    this.w = w; this.h = h;
    this.data = data ?? new Uint8Array(w * h); // zeroed (all off)
    if (this.data.length !== w * h) throw new Error("PixelFrame: bad data length");
  }

  /** Read pixel at (x,y). Returns 0 or 1. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  /** Set pixel at (x,y) to 0/1. */
  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = v ? 1 : 0;
  }

  /** Apply XOR diff bytes (0/1 per pixel) in-place to become the next absolute frame. */
  xorInPlace(diff: Uint8Array): void {
    if (diff.length !== this.data.length) throw new Error("xorInPlace: size mismatch");
    for (let i = 0; i < this.data.length; i++) this.data[i] ^= diff[i] & 1;
  }

  /** Clone (shallow copy of the data). */
  clone(): PixelFrame {
    return new PixelFrame(this.w, this.h, this.data.slice());
  }

  /** Quick factory from a boolean[] (true=1/false=0) without extra boxing in hot path. */
  static fromBools(w: number, h: number, bools: boolean[]): PixelFrame {
    if (bools.length !== w * h) throw new Error("fromBools: bad length");
    const u8 = new Uint8Array(bools.length);
    for (let i = 0; i < bools.length; i++) u8[i] = bools[i] ? 1 : 0;
    return new PixelFrame(w, h, u8);
  }
}

/**
 * Budgeted frame applier:
 * - Holds the "current" absolute frame buffer (Uint8Array) for the big screen.
 * - On startFrame(next), it sets an internal pointer = 0.
 * - Each step(maxToggles) scans row-major, toggling ramparts only where current != next,
 *   up to maxToggles, then returns progress. Safe to call every tick.
 */
export class FrameApplier {
  readonly screen: BigScreen;
  readonly w: number;
  readonly h: number;

  /** Current state of what's shown (0/1); same shape as frames. */
  private curr: Uint8Array;
  /** Target frame we're converging to. */
  private target: PixelFrame | null = null;
  /** Resume pointer into [0..w*h). */
  private ptr = 0;

  constructor(screen: BigScreen) {
    this.screen = screen;
    this.w = screen.width;
    this.h = screen.height;
    this.curr = new Uint8Array(this.w * this.h); // starts all 0/private
    this.resetToRampartState();
  }

  resetToRampartState(): void {
    // Scan all ramparts on the big screen and set curr[] accordingly
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const id = this.screen.getRampartIdAt(x, y);
        if (id) {
          const obj = Game.getObjectById<StructureRampart>(id);
          this.curr[y * this.w + x] = (obj?.isPublic ?? false) ? 1 : 0;
        } else {
          this.curr[y * this.w + x] = 0;
        }
      }
    }
    this.target = null;
    this.ptr = 0;
  }

  /** Reset current buffer (e.g., after rebuild) to a known frame. */
  resetTo(frame: PixelFrame): void {
    this.ensureDims(frame);
    this.curr.set(frame.data);
    this.target = null;
    this.ptr = 0;
  }

  /** Begin applying a new target frame; does not toggle immediately. */
  startFrame(frame: PixelFrame): void {
    this.ensureDims(frame);
    this.target = frame;
    this.ptr = 0;
  }

  /** Returns true once fully applied (or if no target). */
  isDone(): boolean {
    return !this.target || this.ptr >= this.curr.length;
  }

  /**
   * Do up to `maxToggles` rampart toggles to move current → target.
   * Returns { toggled, remaining, done }.
   * Call this once per tick with your budget (e.g., Math.floor(60/0.2)=300).
   */
  step(maxToggles: number): { toggled: number; remaining: number; done: boolean } {
    const tgt = this.target;
    if (!tgt) return { toggled: 0, remaining: 0, done: true };

    const total = this.curr.length;
    let toggled = 0;
    let i = this.ptr;

    while (i < total && toggled < maxToggles) {
      if (this.curr[i] !== tgt.data[i]) {
        // map index → big-screen coords
        const x = i % this.w;
        const y = (i / this.w) | 0;

        const id = this.screen.getRampartIdAt(x, y);
        if (id) {
          const obj = Game.getObjectById<StructureRampart>(id);
          // Desired: 1 => public; 0 => private
          obj?.setPublic(tgt.data[i] === 1);
          this.curr[i] = tgt.data[i]; // keep curr in sync even if obj missing
          toggled++;
        } else {
          // no rampart: just sync buffer so we don't keep trying
          this.curr[i] = tgt.data[i];
        }
      }
      i++;
    }

    this.ptr = i;
    const done = this.ptr >= total;
    return { toggled, remaining: total - this.ptr, done };
  }

  private ensureDims(frame: PixelFrame) {
    if (frame.w !== this.w || frame.h !== this.h) {
      throw new Error(`FrameApplier: dim mismatch (${frame.w}x${frame.h} vs screen ${this.w}x${this.h})`);
    }
  }
}
