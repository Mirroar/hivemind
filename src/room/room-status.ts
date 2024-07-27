import cache from "utils/cache";

declare global {
	interface StrategyMemory {
		roomList?: Record<string, RoomListEntry>;
	}
}

interface RoomListEntry {
    scoutPriority?: number;
    expansionScore?: number;
    harvestPriority?: number;
    range: number;
    expansionReasons?: Record<string, number>;
    safePath?: boolean;
    origin: string;
}

// @todo Make this a config option.
const preserveExpansionReasons = false;

export default class RoomStatus {
    memory: Record<string, RoomListEntry>;

    constructor() {
        if (!Memory.strategy) {
            Memory.strategy = {};
        }

        if (!Memory.strategy.roomList) {
            Memory.strategy.roomList = {};
        }

        this.memory = Memory.strategy.roomList;
    }

    resetScores(roomName: string): void {
        delete this.memory[roomName].scoutPriority;
        delete this.memory[roomName].expansionScore;
        delete this.memory[roomName].expansionReasons;
        delete this.memory[roomName].harvestPriority;
    }

    setExpansionScore(roomName: string, score: number, reasons: Record<string, number>): void {
        this.memory[roomName].expansionScore = score;
        if (preserveExpansionReasons) {
            this.memory[roomName].expansionReasons = reasons;
        }
    }

    setHarvestPriority(roomName: string, priority: number): void {
        this.memory[roomName].harvestPriority = priority;
    }

    setScoutPriority(roomName: string, priority: number): void {
        this.memory[roomName].scoutPriority = priority;
    }

    getAllKnownRooms(): string[] {
        return Object.keys(this.memory);
    }

    getPotentialExpansionTargets(): string[] {
        return cache.inHeap('RoomStatus.expansionTargets', 1000, () => {
            return this.getAllKnownRooms().filter(
                roomName => this.getExpansionScore(roomName) !== null && !Game.rooms[roomName]?.isMine()
            );
        });
    }

    getPotentialScoutTargets(): string[] {
        return cache.inHeap('RoomStatus.scoutTargets', 1000, () => {
            return this.getAllKnownRooms().filter(
                roomName => this.getScoutPriority(roomName) > 0
            );
        });
    }

    hasRoom(roomName: string): boolean {
        return this.memory[roomName] !== undefined;
    }

    deleteRoom(roomName: string): void {
        delete this.memory[roomName];
    }

    getOrigin(roomName: string): string {
        return this.memory[roomName].origin;
    }

    getDistanceToOrigin(roomName: string): number {
        return this.memory[roomName].range;
    }

    getExpansionScore(roomName: string): number | null {
        return this.memory[roomName].expansionScore ?? null;
    }

    getHarvestPriority(roomName: string): number {
        return this.memory[roomName].harvestPriority ?? 0;
    }

    getScoutPriority(roomName: string): number {
        return this.memory[roomName].scoutPriority ?? 0;
    }
}
