import hivemind from 'hivemind';
import {getRoomIntel} from 'room-intel';

type CreepIntel = {
	body: Partial<Record<BodyPartConstant, number>>,
	boosts?: Partial<Record<ResourceConstant, number>>,
	pos: {
		x: number;
		y: number;
		roomName: string;
	};
	lastSeen: number;
	expires: number;
};

export type PlayerIntelMemory = {
	lastSeen: number;
	creeps: Record<Id<Creep>, CreepIntel>;
	rooms: Record<string, number>;
	remotes: Record<string, number>;
	lastCleanup?: number;
};

const CLEANUP_INTERVAL = 120;

export default class PlayerIntel {
	protected memory: PlayerIntelMemory;
	protected readonly memoryKey: string;

	constructor(readonly userName: string) {
		this.memoryKey = 'u-intel:' + userName;
		if (!this.hasMemory()) {
			this.setMemory({
				lastSeen: Game.time,
				creeps: {},
				rooms: {},
				remotes: {},
			});
		}

		this.memory = this.getMemory();

		if (!this.memory.lastCleanup || Game.time - this.memory.lastCleanup > CLEANUP_INTERVAL) {
			this.cleanupMemory();
		}
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

	cleanupMemory() {
		for (const roomName in this.memory.rooms) {
			const roomIntel = getRoomIntel(roomName);

			if (!roomIntel || roomIntel.getOwner() !== this.userName) {
				delete this.memory.rooms[roomName];
			}
		}

		for (const roomName in this.memory.remotes) {
			if (Game.time - this.memory.remotes[roomName] > CREEP_LIFE_TIME) {
				delete this.memory.remotes[roomName];
			}
		}

		for (const id in this.memory.creeps) {
			const creepIntel = this.memory.creeps[id];

			// @todo Also delete creeps we can be sure have died. We could check
			// tombstones, for example.
			if (Game.time > creepIntel.expires) delete this.memory.creeps[id];
		}
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

	getAllRemotes(): string[] {
		return _.keys(this.memory.remotes);
	}

	updateRemote(roomName: string) {
		this.memory.remotes[roomName] = Game.time;
	}

	updateCreeps(creeps: Creep[]) {
		if (!this.memory.creeps) this.memory.creeps = {};

		for (const creep of creeps) {
			if (!this.memory.creeps[creep.id]) {
				// Record some info about this creep.
				this.memory.creeps[creep.id] = {
					body: _.countBy(creep.body, 'type'),
					boosts: _.countBy(creep.body, 'boost'),
					pos: null,
					lastSeen: Game.time,
					expires: Game.time + creep.ticksToLive,
				};
			}

			// Update some information.
			const creepIntel = this.memory.creeps[creep.id];

			creepIntel.lastSeen = Game.time;

			const {x, y, roomName} = creep.pos;
			creepIntel.pos = {x, y, roomName};
		}
	}
}
