import { BigScreen } from "display/screens";
import { FrameApplier } from "display/frame";
import { SpiralTestPattern } from "display/spiral";
import { TextSprite, Marquee } from "display/marquee";
import { badAppleRooms, isBadApplePlayerShard } from "warmind.local/settings";

const ROOMS = {
    NW: badAppleRooms[0] || 'E10N10',
    SW: badAppleRooms[1] || 'E10N9',
    NE: badAppleRooms[2] || 'E11N10',
    SE: badAppleRooms[3] || 'E11N9',
};

let bigScreen: BigScreen;
let player: FrameApplier;
let spiral: SpiralTestPattern;
let marquee: Marquee;

if (isBadApplePlayerShard) {
    if (!bigScreen) {
        bigScreen = new BigScreen(ROOMS, {
            margin: 0, perRoomW: 50, perRoomH: 36, blockSize: 1, ttlTicks: 500
        });
        // Cache ramparts right away if visible
        bigScreen.refreshAll(true);
    }

    if (!player) {
        player = new FrameApplier(bigScreen);
    }

    if (!spiral) {
        const w = bigScreen.width;
        const h = bigScreen.height;
        spiral = new SpiralTestPattern(w, h, {
            arms: 6,
            tightness: 0.45,
            degPerTick: 0.5,    // slow, smooth rotation; try 1.0 if you like
            bandBase: 0.26,
            bandGain: 0.9,
            invert: false
        });
    }

    if (!marquee) {
        const text = 'PLEASE STAND BY...';
        const textSprite = new TextSprite(text, {
            scale: 2,
            letterSpacing: 1,
        });
        marquee = new Marquee(textSprite, bigScreen.width, bigScreen.height, {
            speed: 1,
            y: 4,
            gap: 20,
            overwrite: true,
        });
    }
}

export function loop() {
    if (!isBadApplePlayerShard) return;

  // Keep rampart cache fresh (cheap when not visible)
  if ((Game.time & 0x1FF) === 0) bigScreen.refreshAll();

  // If last frame finished, generate the next spiral frame and start applying
  if (player.isDone()) {
    const frame = spiral.tick();
    marquee.tick();
    marquee.overlay(frame);
    player.startFrame(frame);
  }

  // Spend your toggle budget this tick
  const TOGGLE_CPU = 60;                    // reserve some CPU for the rest of empire
  const COST_PER_TOGGLE = 0.2;
  const BUDGET = Math.floor(TOGGLE_CPU / COST_PER_TOGGLE);

  player.step(BUDGET);
}
