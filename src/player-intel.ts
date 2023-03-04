import hivemind from 'hivemind';

export type PlayerIntelMemory = {
	lastSeen: number;
	rooms: Record<string, number>;
	remotes: Record<string, number>;
};

export default class PlayerIntel {
	protected memory: PlayerIntelMemory;
	protected readonly memoryKey: string;

	constructor(readonly userName: string) {
		this.memoryKey = 'u-intel:' + userName;
		if (!this.hasMemory()) {
			this.setMemory({
				lastSeen: Game.time,
				rooms: {},
				remotes: {},
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

	getAllOwnedRooms(): string[] {
		return _.keys(this.memory.rooms);
	}

	updateOwnedRoom(roomName: string) {
		this.memory.rooms[roomName] = Game.time;
	}

	removeOwnedRoom(roomName: string) {
		delete this.memory.rooms[roomName];
	}

	getAllRemotes(): string[] {
		return _.keys(this.memory.remotes);
	}

	updateRemote(roomName: string) {
		this.memory.remotes[roomName] = Game.time;
	}

	removeRemote(roomName: string) {
		delete this.memory.remotes[roomName];
	}
}
