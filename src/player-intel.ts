import hivemind from 'hivemind';

export type PlayerIntelMemory = {
	lastSeen: number;
	rooms: string[];
	remotes: string[];
};

export default class PlayerIntel {
	protected memory: PlayerIntelMemory;
	protected readonly memoryKey: string;

	constructor(readonly userName: string) {
		this.memoryKey = 'u-intel:' + userName;
		if (!this.hasMemory()) {
			this.setMemory({
				lastSeen: Game.time,
				rooms: [],
				remotes: [],
			});
		}

		this.memory = this.getMemory();
	}

	hasMemory() {
		return hivemind.segmentMemory.has(this.memoryKey);
	}

	setMemory(memory: PlayerIntelMemory) {
		hivemind.segmentMemory.set(this.memoryKey, memory);
	}

	getMemory(): PlayerIntelMemory {
		return hivemind.segmentMemory.get(this.memoryKey);
	}

	isNpc(): boolean {
		return this.userName === SYSTEM_USERNAME || this.userName === 'Invader';
	}

	setPlayerRooms(rooms: string[]) {
		this.memory.rooms = rooms;
	}

	getAllPlayerRooms(): string[] {
		return this.memory.rooms;
	}

	setPlayerRemotes(rooms: string[]) {
		this.memory.remotes = rooms;
	}

	getAllPlayerRemotes(): string[] {
		return this.memory.remotes;
	}
}
