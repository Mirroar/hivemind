// marquee.ts
// Minimal 5x7 font + pre-rendered text sprite + marquee overlay.
// Works with your PixelFrame + SpiralTestPattern + FrameApplier.

import { PixelFrame } from "display/frame";

// --- 5x7 uppercase font for needed chars ---
const FONT_5x7: Record<string, string[]> = {
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'N': ['10001','10001','11001','10101','10011','10001','10001'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'Y': ['10001','01010','00100','00100','00100','00100','00100'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','00100','00100'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['01110','10001','00001','00110','00001','10001','01110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '%': ['11000','11001','00010','00100','01000','10011','00011'],
};

export interface TextSpriteOpts {
  scale?: number;        // pixel scale factor (e.g. 2 or 3); default 2
  letterSpacing?: number;// spaces (in scaled pixels) between glyphs; default 1
  padLeft?: number;      // pixels of left padding in output sprite; default 0
  padRight?: number;     // pixels of right padding; default 0 (you can use as marquee gap)
  padTop?: number;       // pixels of top padding; default 0
  padBottom?: number;    // pixels of bottom padding; default 0
}

export class TextSprite {
  readonly text: string;
  readonly scale: number;
  readonly spacing: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
  readonly glyphW = 5;
  readonly glyphH = 7;
  readonly frame: PixelFrame; // pre-rendered text bitmap (0/1)

  constructor(text: string, opts: TextSpriteOpts = {}) {
    this.text = text;
    this.scale = opts.scale ?? 2;
    this.spacing = opts.letterSpacing ?? 1;
    this.padLeft = opts.padLeft ?? 0;
    this.padRight = opts.padRight ?? 0;
    this.padTop = opts.padTop ?? 0;
    this.padBottom = opts.padBottom ?? 0;

    const wPerGlyph = this.glyphW * this.scale;
    const hScaled = this.glyphH * this.scale;
    const track = this.text.length === 0 ? 0
      : (this.text.length - 1) * this.spacing;
    const w = this.padLeft + this.padRight + this.text.length * wPerGlyph + track;
    const h = hScaled + this.padTop + this.padBottom;

    this.frame = new PixelFrame(w, h);
    this.render();
  }

  private render(): void {
    const out = this.frame.data;
    const w = this.frame.w;
    const h = this.frame.h;
    // clear
    out.fill(0);

    let penX = this.padLeft;
    for (let i = 0; i < this.text.length; i++) {
      const ch = this.text[i];
      const rows = FONT_5x7[ch] ?? FONT_5x7[' '];
      // draw glyph scaled
      for (let gy = 0; gy < 7; gy++) {
        const row = rows[gy];
        for (let gx = 0; gx < 5; gx++) {
          if (row.charCodeAt(gx) === 49) { // '1'
            // stamp scale×scale block
            const x0 = penX + gx * this.scale;
            const y0 = this.padTop + gy * this.scale;
            for (let sy = 0; sy < this.scale; sy++) {
              const yy = y0 + sy;
              const off = yy * w;
              for (let sx = 0; sx < this.scale; sx++) {
                out[off + (x0 + sx)] = 1;
              }
            }
          }
        }
      }
      penX += 5 * this.scale + this.spacing;
    }
  }
}

export interface MarqueeOpts {
  speed?: number;     // pixels per tick (e.g. 1); default 1
  y?: number;         // top y on destination frame; default center vertically
  gap?: number;       // extra gap between repeats (pixels); default 8
  overwrite?: boolean;// true: force 1 over dest; false: OR-blend (dest=dest|src); default true
  border?: number;    // pixels of blank border around marquee
}

/** Scrolls a TextSprite across a destination frame (wrap-around). */
export class Marquee {
  readonly sprite: TextSprite;
  readonly speed: number;
  readonly gap: number;
  readonly overwrite: boolean;
  private yTop: number | null;
  private offset = 0; // horizontal scroll offset, increases each tick
  private wrapW: number;
  private border: number;

  constructor(sprite: TextSprite, destW: number, destH: number, opts: MarqueeOpts = {}) {
    this.sprite = sprite;
    this.speed = opts.speed ?? 1;
    this.gap = opts.gap ?? 8;
    this.overwrite = opts.overwrite ?? true;
    this.yTop = Number.isFinite(opts.y as number) ? (opts.y as number) : null;
    this.wrapW = sprite.frame.w + this.gap;
    this.border = opts.border ?? 0;

    // center vertically if y not provided
    if (this.yTop == null) {
      this.yTop = Math.max(0, ((destH - this.sprite.frame.h) / 2) | 0);
    }
  }

  /** Advance by one tick. */
  tick(): void {
    this.offset = Math.floor(Game.time * this.speed) % this.wrapW;
  }

  /** Overlay onto dest frame (0/1). Very cheap loops. */
  overlay(dest: PixelFrame): void {
    const dw = dest.w, dh = dest.h;
    const sw = this.sprite.frame.w, sh = this.sprite.frame.h;
    const syTop = 0, syBot = sh;
    const dyTop = this.yTop!;
    const dyBot = Math.min(dh, dyTop + (syBot - syTop));

    // nothing to draw if out of bounds
    if (dyTop >= dh || dyTop >= dyBot) return;

    const src = this.sprite.frame.data;
    const dst = dest.data;

    // For each dest x, map to src x within wrap band: sx = (x + offset) % wrapW
    // Only draw when sx < sw (skip the gap area)
    for (let y = dyTop; y < dyBot; y++) {
      const di = y * dw;
      const siBase = (y - dyTop) * sw;
      for (let x = 0; x < dw; x++) {
        const sxWrapped = (x + this.offset) % this.wrapW;
        if (sxWrapped < sw) {
          const s = src[siBase + sxWrapped];
          if (this.overwrite) dst[di + x] = s;
          else dst[di + x] |= s;
        }
        else dst[di + x] = 0; // clear gap area
      }
    }

    if (this.border > 0) {
      const b = this.border;
      // top border
      for (let y = 0; y < b; y++) {
        const dy = dyTop - y - 1;
        if (dy < 0) continue;
        const di = dy * dw;
        for (let x = 0; x < dw; x++) {
          dst[di + x] = 1;
        }
      }
      // bottom border
      for (let y = 0; y < b; y++) {
        const dy = dyBot + y;
        const di = dy * dw;
        for (let x = 0; x < dw; x++) {
          dst[di + x] = 1;
        }
      }
    }
  }
}
