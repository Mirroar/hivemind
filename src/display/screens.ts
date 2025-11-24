// screen-manager.ts
// Screeps TypeScript — per-room + big 2×2 screen managers for rampart "pixels"

type Quadrant = 'NW' | 'NE' | 'SW' | 'SE';
type RampId = Id<StructureRampart>;

export interface ScreenConfig {
  margin?: number;     // default 2
  perRoomW?: number;   // default 46 (columns inside margin)
  perRoomH?: number;   // default 34 (rows inside margin, aligned top/bottom)
  blockSize?: number;  // default 1 (one tile per pixel). If >1, only the block's top-left is used.
  ttlTicks?: number;   // optional: refresh cache if older than this many ticks
}

/** Small manager for one room's panel slice (e.g., 46×34). */
export class PerRoomScreen {
  readonly roomName: string;
  readonly isTop: boolean; // top row aligns screen to bottom; bottom row aligns to top
  readonly cfg: Required<ScreenConfig>;

  // Screen rectangle inside the 50×50 room (tile coordinates, inclusive-exclusive)
  private x0 = 0;
  private y0 = 0;
  private w = 0;
  private h = 0;

  // Fast lookup: tileIndex (y*50 + x) -> rampart id
  private tileToId?: RampId[]; // length 2500, undefined when not visible / not cached
  private lastBuiltTick = -1;

  constructor(roomName: string, isTop: boolean, cfg: ScreenConfig = {}) {
    this.roomName = roomName;
    this.isTop = isTop;
    this.cfg = {
      margin: cfg.margin ?? 2,
      perRoomW: cfg.perRoomW ?? 46,
      perRoomH: cfg.perRoomH ?? 34,
      blockSize: cfg.blockSize ?? 1,
      ttlTicks: cfg.ttlTicks ?? 0,
    };
    this.computeRect();
    this.refreshCache(); // do this once on global reset if room is visible
  }

  /** local screen width/height (in pixels, not tiles) for this room's slice */
  get width(): number  { return Math.floor(this.cfg.perRoomW / this.cfg.blockSize); }
  get height(): number { return Math.floor(this.cfg.perRoomH / this.cfg.blockSize); }

  /** Map a local pixel (px,py) → world tile (x,y) inside this room, respecting blockSize and alignment. */
  localPixelToTile(px: number, py: number): { x: number; y: number } {
    const { blockSize } = this.cfg;
    return {
      x: this.x0 + px * blockSize,
      y: this.y0 + py * blockSize,
    };
  }

  /** Return the rampart id at local pixel (px,py), or null if no rampart / not visible. */
  getRampartIdAtLocal(px: number, py: number): RampId | null {
    if (!this.tileToId) return null;
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return null;
    const { x, y } = this.localPixelToTile(px, py);
    if (x < this.x0 || x >= this.x0 + this.cfg.perRoomW) return null;
    if (y < this.y0 || y >= this.y0 + this.cfg.perRoomH) return null;
    const id = this.tileToId[y * 50 + x];
    return id ?? null;
  }

  /** Rebuild cache now (no-op if room not visible). Safe to call periodically. */
  refreshCache(force = false): void {
    const room = Game.rooms[this.roomName];
    if (!room) return; // not visible
    if (!force && this.cfg.ttlTicks > 0 && this.lastBuiltTick > 0) {
      if (Game.time - this.lastBuiltTick < this.cfg.ttlTicks) return;
    }

    const rps: StructureRampart[] = room.myStructuresByType[STRUCTURE_RAMPART] || [];

    const arr: RampId[] = new Array(50 * 50);
    for (const r of rps) {
      const idx = r.pos.y * 50 + r.pos.x;
      arr[idx] = r.id as RampId;
    }
    this.tileToId = arr;
    this.lastBuiltTick = Game.time;
  }

  /** internal: compute the aligned 46×34 (or custom) rectangle inside this room */
  private computeRect(): void {
    const { margin, perRoomW, perRoomH } = this.cfg;
    const W = 50, H = 50;
    this.w = perRoomW;
    this.h = perRoomH;
    this.x0 = margin;
    // vertical alignment: top rooms attach to bottom; bottom rooms attach to top
    this.y0 = this.isTop ? (H - margin - perRoomH) : margin;
  }
}

/** Manager for the full 2×2 big screen. Provides getRampartIdAt(x,y) over the combined grid. */
export class BigScreen {
  // Quadrants: NW (top-left), NE (top-right), SW (bottom-left), SE (bottom-right)
  readonly parts: Record<Quadrant, PerRoomScreen>;
  readonly cfg: Required<ScreenConfig>;

  constructor(
    rooms: { NW: string; NE: string; SW: string; SE: string },
    cfg: ScreenConfig = {}
  ) {
    this.cfg = {
      margin: cfg.margin ?? 2,
      perRoomW: cfg.perRoomW ?? 46,
      perRoomH: cfg.perRoomH ?? 34,
      blockSize: cfg.blockSize ?? 1,
      ttlTicks: cfg.ttlTicks ?? 0,
    };
    // Top row = bottom-aligned
    this.parts = {
      NW: new PerRoomScreen(rooms.NW, /*isTop=*/true, this.cfg),
      NE: new PerRoomScreen(rooms.NE, /*isTop=*/true, this.cfg),
      // Bottom row = top-aligned
      SW: new PerRoomScreen(rooms.SW, /*isTop=*/false, this.cfg),
      SE: new PerRoomScreen(rooms.SE, /*isTop=*/false, this.cfg),
    };
  }

  /** Big screen width/height (in pixels), combining both rooms horizontally/vertically. */
  get width(): number  { return this.parts.NW.width + this.parts.NE.width; }
  get height(): number { return this.parts.NW.height + this.parts.SW.height; }

  /** Rebuild caches for all rooms now (if visible). */
  refreshAll(force = false): void {
    this.parts.NW.refreshCache(force);
    this.parts.NE.refreshCache(force);
    this.parts.SW.refreshCache(force);
    this.parts.SE.refreshCache(force);
  }

  /**
   * Return the rampart id at big-screen (x,y) or null.
   * x ∈ [0..width-1], y ∈ [0..height-1] — pixel coordinates (respecting blockSize).
   */
  getRampartIdAt(x: number, y: number): RampId | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;

    const leftW = this.parts.NW.width;
    const topH  = this.parts.NW.height;

    const left = x < leftW;
    const top  = y < topH;

    const localX = left ? x : x - leftW;
    const localY = top  ? y : y - topH;

    if (top && left)  return this.parts.NW.getRampartIdAtLocal(localX, localY);
    if (top && !left) return this.parts.NE.getRampartIdAtLocal(localX, localY);
    if (!top && left) return this.parts.SW.getRampartIdAtLocal(localX, localY);
    return this.parts.SE.getRampartIdAtLocal(localX, localY);
  }
}
