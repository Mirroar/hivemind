import { BigScreen } from "display/screens";
import { FrameApplier } from "display/frame";
import { SpiralTestPattern } from "display/spiral";
import { TextSprite, Marquee } from "display/marquee";
import { badAppleRooms, isBadApplePlayerShard } from "warmind.local/settings";
import { calculateScreepRepairProgress, shouldRoomRepairScreenRamparts } from "./rampartManagement";
import hivemind from "hivemind";
import cache from "utils/cache";
import { decodeFrame, getDecodedVideoFrames } from "warmind.local/video";

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
let textRecalculatedAt = 0;
let videoFrameData: Uint8Array[];
let currentVideoFrameIndex = 0;
let isPlayingVideo = false;

function initializeBadAppleDisplay(): void {
    if (!isBadApplePlayerShard) {
        return;
    }

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
            arms: 5,
            tightness: 0.55,
            degPerTick: 0.3,
            bandBase: 0.25,
            bandGain: 0.9,
            invert: false
        });
    }

    if (!marquee || hivemind.hasIntervalPassed(1000, textRecalculatedAt)) {
        textRecalculatedAt = Game.time;
        const progress = calculateScreepRepairProgress();
        const text = `PLEASE STAND BY... ${Math.floor(progress * 100)}% BUILT... `;
        const textSprite = new TextSprite(text, {
            scale: 2,
            letterSpacing: 1,
            padTop: 3,
            padBottom: 3,
        });
        marquee = new Marquee(textSprite, bigScreen.width, bigScreen.height, {
            speed: 0.5,
            y: 4,
            overwrite: true,
            border: 1,
        });
    }

    if (!videoFrameData) {
        try {
            videoFrameData = getDecodedVideoFrames();
        } catch (e) {
            console.log("Failed to decode video frames:", e);
            videoFrameData = [];
        }
    }
}

export function loop() {
    if (!isBadApplePlayerShard) return;

    initializeBadAppleDisplay();

    // Keep rampart cache fresh (cheap when not visible)
    if ((Game.time & 0x1FF) === 0) bigScreen.refreshAll();

    const tickToDisplay = isPlayingVideo && currentVideoFrameIndex > 0 ? currentVideoFrameIndex : Game.time;
    updateTimeKeeperDisplay(tickToDisplay);

    const needsRepairs = cache.inHeap('baScreenNeedsRepairs', 1000, () => {
        for (const roomName of badAppleRooms) {
            if (!(roomName in Game.rooms)) {
                continue;
            }

            if (shouldRoomRepairScreenRamparts(Game.rooms[roomName])) {
                return true;
            }
        }

        return false;
    });

    // Check if we should start playing video
    if (!isPlayingVideo) {
        if (Game.time % 100 >= 80 && Game.time % 100 <= 90) {
            const progress = calculateScreepRepairProgress();
            if (progress > 0.6) {
                isPlayingVideo = true;
                currentVideoFrameIndex = 0;
                if (videoFrameData && videoFrameData.length > 0) {
                    const frame = decodeFrame(videoFrameData[0]);
                    player.startFrame(frame);
                }
            }
        }
    }

    // Spend your toggle budget this tick
    const TOGGLE_CPU = 125;                    // reserve some CPU for the rest of empire
    const COST_PER_TOGGLE = 0.2;
    const BUDGET = Math.floor(TOGGLE_CPU / COST_PER_TOGGLE);

    if (isPlayingVideo) {
        if (currentVideoFrameIndex === 0) {
            if (Game.time % 100 === 0) {
                currentVideoFrameIndex++;
            } else {
                player.step(BUDGET);
                return;
            }
        }

        if (currentVideoFrameIndex > 0) {
            if (videoFrameData && currentVideoFrameIndex < videoFrameData.length) {
                const frame = decodeFrame(videoFrameData[currentVideoFrameIndex]);
                player.startFrame(frame);
                currentVideoFrameIndex++;
            } else {
                isPlayingVideo = false;
                currentVideoFrameIndex = 0;
            }
        }
    } else {
        // If last frame finished, generate the next spiral frame and start applying
        if (player.isDone()) {
            const frame = spiral.tick();
            marquee.tick();
            marquee.overlay(frame);
            player.startFrame(frame);
        }
    }

    player.step(BUDGET);

    // debugBadAppleVideoFrame();

    // Visual debug of corners of big screen
    for (const coordinate of [[0, 0], [bigScreen.width - 1, 0], [0, bigScreen.height - 1], [bigScreen.width - 1, bigScreen.height - 1]]) {
        const x = coordinate[0];
        const y = coordinate[1];
        const rampartId = bigScreen.getRampartIdAt(x, y);
        const rampart = Game.getObjectById(rampartId);
        const visual = rampart?.room?.visual;
        if (visual) {
            visual.text(`(${x},${y})`, rampart.pos.x, rampart.pos.y, { color: 'red', align: 'center', opacity: 0.7 });
        }
    }
}

function updateTimeKeeperDisplay(tick: number): void {
    const timeKeeperRoomName = badAppleRooms[2];
    const room = Game.rooms[timeKeeperRoomName];
    if (!room) return;

    if (room.roomPlanner.getLocations('timeKeeper').length === 0) {
        // No time keeper planned, yet.
        return;
    }

    const bits = ('0000000000000000' + tick.toString(2)).slice(-16).split('').map(b => b === '1');
    bits.forEach((bit, index) => {
        const rampartId = cache.inHeap(`baTimeKeeperRampart_${timeKeeperRoomName}_${index}`, 10000, () => {
            const loc = room.roomPlanner.getLocations(`timeKeeper.${index}`)[0];
            if (!loc) return null;

            const structures = room.lookForAt(LOOK_STRUCTURES, loc.x, loc.y);
            const rampart = structures.find(s => s.structureType === STRUCTURE_RAMPART) as StructureRampart;
            if (!rampart) return null;

            return rampart.id;
        });
        if (!rampartId) return;

        const rampart = Game.getObjectById<StructureRampart>(rampartId);
        if (!rampart) return;

        if (bit) {
            // Show bit on rampart
            if (!rampart.isPublic)
                rampart.setPublic(true);
        } else {
            // Hide bit
            if (rampart.isPublic)
                rampart.setPublic(false);
        }
    });
}

function debugBadAppleVideoFrame(): void {
    if (!videoFrameData) return;

    // Use room visual to render a preview of the current video frame.
    const debugRoomName = badAppleRooms[0];
    const room = Game.rooms[debugRoomName];
    if (!room) return;

    const frameData = videoFrameData[currentVideoFrameIndex];
    if (!frameData) return;

    const frame = decodeFrame(frameData);

    const visual = room.visual;
    const scale = 0.2;
    for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) {
            if (frame.get(x, y) === 1) continue; // skip white pixels
            visual.rect(x * scale, y * scale, scale, scale, { fill: 'white', opacity: 0.3 });
        }
    }

    // currentVideoFrameIndex = Game.time % videoFrameData.length;
}
