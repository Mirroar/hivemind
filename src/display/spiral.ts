// Draws a multi-arm rotating logarithmic spiral into a reusable PixelFrame.
import { PixelFrame } from "display/frame";

export interface SpiralOpts {
  arms?: number;         // number of arms
  tightness?: number;    // spiral tightness 'a' in theta - a*ln(r) (default 0.35)
  degPerTick?: number;   // angular velocity (deg/tick), e.g. 0.5..1 (default 0.5)
  bandBase?: number;     // base thickness (sin-band threshold) (default 0.06)
  bandGain?: number;     // extra thickness near center (scaled by 1/(1+r)) (default 0.9)
  invert?: boolean;      // invert on/off pixels (default false)
}

export class SpiralTestPattern {
  readonly w: number;
  readonly h: number;
  readonly arms: number;
  readonly a: number;
  readonly omega: number;   // radians per tick
  readonly bandBase: number;
  readonly bandGain: number;
  readonly invert: boolean;

  private theta: Float32Array;   // angle per pixel (−π..π)
  private logR: Float32Array;    // ln(r) per pixel (r>=~0)
  private invR: Float32Array;    // 1/(1+r) per pixel for thickness scaling
  private phase = 0;             // accumulated rotation

  // reusable frame buffer (avoid per-tick allocations)
  private frame: PixelFrame;

  constructor(w: number, h: number, opts: SpiralOpts = {}) {
    this.w = w; this.h = h;
    this.arms = opts.arms ?? 5;
    this.a = opts.tightness ?? 0.35;
    this.omega = (opts.degPerTick ?? 0.5) * Math.PI / 180;
    this.bandBase = opts.bandBase ?? 0.06;
    this.bandGain = opts.bandGain ?? 0.9;
    this.invert = !!opts.invert;

    this.theta = new Float32Array(w * h);
    this.logR  = new Float32Array(w * h);
    this.invR  = new Float32Array(w * h);
    this.precomputePolar();

    this.frame = new PixelFrame(w, h);
  }

  private precomputePolar(): void {
    const cx = (this.w - 1) * 0.5;
    const cy = (this.h - 1) * 0.5;
    const eps = 1e-3;

    let i = 0;
    for (let y = 0; y < this.h; y++) {
      const dy = y - cy;
      for (let x = 0; x < this.w; x++, i++) {
        const dx = x - cx;
        const theta = Math.atan2(dy, dx);       // −π..π
        const r = Math.hypot(dx, dy) + eps;     // avoid 0
        this.theta[i] = theta;
        this.logR[i]  = Math.log(r);
        this.invR[i]  = 1 / (1 + r);            // thicker near center
      }
    }
  }

  /** Advance phase by one tick (or a custom amount) and render into internal frame. */
  tick(): PixelFrame {
    this.phase = this.omega * Game.time;

    const N = this.w * this.h;
    const m = this.arms;
    const a = this.a;
    const base = this.bandBase;
    const gain = this.bandGain;
    const out = this.frame.data;

    for (let i = 0; i < N; i++) {
      // Log-spiral arm equation ~ theta ≈ a*ln(r) + k*2π/m + phase
      // distance from arm via sin-band:
      const v = Math.sin(m * (this.theta[i] - a * this.logR[i]) + this.phase);
      const band = Math.abs(v);
      const thr = base + gain * this.invR[i];   // thin far away, thicker near center
      const on = band < thr ? 1 : 0;
      out[i] = this.invert ? (1 - on) : on;
    }
    return this.frame;
  }
}
