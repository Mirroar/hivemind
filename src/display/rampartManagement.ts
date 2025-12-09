import cache from "utils/cache";
import { badAppleRooms, isBadApplePlayerShard } from "warmind.local/settings";

export const MIN_RAMPART_TICKS_UNTIL_DECAY = 20_000;
export const MIN_SCREEN_RAMPART_HITS = RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME * MIN_RAMPART_TICKS_UNTIL_DECAY;

export const DESIRED_RAMPART_TICKS_UNTIL_DECAY = 50_000;
export const DESIRED_SCREEN_RAMPART_HITS = RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME * DESIRED_RAMPART_TICKS_UNTIL_DECAY;

export const MAX_SCREEN_RAMPART_HITS = DESIRED_SCREEN_RAMPART_HITS * 1.5;

declare global {
    interface Memory {
        baScreen: {
            isInRepairMode: boolean;
        };
    }
}

export function calculateScreepRepairProgress(): number {
    if (!isBadApplePlayerShard) {
        return 1;
    }

    let totalProgress = 0;
    let maxProgress = 0;

    for (const roomName of badAppleRooms) {
        if (!(roomName in Game.rooms)) {
            continue;
        }

        const { progress, max } = cache.inHeap(`baScreenRampartRepairProgress_${roomName}`, 1000, () => {
            let roomProgress = 0;
            let roomMaxProgress = 0;

            const roomPlanner = Game.rooms[roomName].roomPlanner;
            for (const location of roomPlanner.getLocations('screen')) {
                const rampart = Game.rooms[roomName].lookForAt(LOOK_STRUCTURES, location.x, location.y).find(s => s.structureType === STRUCTURE_RAMPART);

                const hits = rampart ? rampart.hits : 0;
                const clampedHits = Math.min(hits, DESIRED_SCREEN_RAMPART_HITS);

                roomProgress += clampedHits;
                roomMaxProgress += DESIRED_SCREEN_RAMPART_HITS;
            }

            Game.notify(`${roomName} screen rampart progress: ${roomProgress} / ${roomMaxProgress} (${((roomProgress / roomMaxProgress) * 100).toFixed(2)}%)`);

            return { progress: roomProgress, max: roomMaxProgress };
        });
        totalProgress += progress;
        maxProgress += max;
    }

    if (maxProgress === 0) {
        return 0;
    }

    return totalProgress / maxProgress;
}

export function shouldRoomRepairScreenRamparts(room: Room): boolean {
    if (!isBadApplePlayerShard) {
        return false;
    }
    if (!badAppleRooms.includes(room.name)) {
        return false;
    }

    if (!Memory.baScreen) {
        Memory.baScreen = {
            isInRepairMode: true,
        };
    }

    if (getRoomMinScreenRampartHits(room.name) >= DESIRED_SCREEN_RAMPART_HITS) {
        // No need to repair if all screen ramparts are above desired level.
        // We jsut wait for the other rooms to catch up.
        return false;
    }
    if (getRoomMinScreenRampartHits(room.name) < MIN_SCREEN_RAMPART_HITS) {
        // Definitely need to repair if below minimum.
        Memory.baScreen.isInRepairMode = true;
        return true;
    }

    // If we're inbetween min and desired level, check all rooms to see if we are in repair mode.
    checkNeedsScreenRepairs();

    return Memory.baScreen.isInRepairMode;
}

function checkNeedsScreenRepairs(): void {
    let isAnyBelowDesired = false;
    for (const roomName of badAppleRooms) {
        if (!(roomName in Game.rooms)) {
            continue;
        }

        const minScreenRampartHits = getRoomMinScreenRampartHits(roomName);
        if (minScreenRampartHits < MIN_SCREEN_RAMPART_HITS) {
            // If one room is below minimum, go into repair mode.
            Memory.baScreen.isInRepairMode = true;
            return;
        }

        if (minScreenRampartHits < DESIRED_SCREEN_RAMPART_HITS) {
            isAnyBelowDesired = true;
        }
    }

    // If all rooms are above desired, exit repair mode.
    if (!isAnyBelowDesired) {
        Memory.baScreen.isInRepairMode = false;
    }
}

function getRoomMinScreenRampartHits(roomName: string): number {
    return cache.inHeap(`baMinScreenRampartHits_${roomName}`, 1000, ()=> {
        let minHits = Infinity;
        const roomPlanner = Game.rooms[roomName].roomPlanner;
        for (const location of roomPlanner.getLocations('screen')) {
            const rampart = Game.rooms[roomName].lookForAt(LOOK_STRUCTURES, location.x, location.y).find(s => s.structureType === STRUCTURE_RAMPART);

            const hits = rampart ? rampart.hits : 0;
            if (hits < minHits) {
                minHits = hits;
            }
        }

        return minHits;
    });
}