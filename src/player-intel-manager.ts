import PlayerIntel from './player-intel';
import hivemind from './hivemind';

const memoryKey = 'player-intel-manager';

interface PlayerIntelManagerMemory {
	ownedRoomSightings: Record<string, Record<string, number>>;
	claimedRoomSightings: Record<string, Record<string, number>>;
	creepSightings: Record<string, Record<string, number>>;
};

export default class PlayerIntelManager {
	intelCache: Record<string, PlayerIntel> = {};
	memory: PlayerIntelManagerMemory;
	usesSegmentMemory: false;

	constructor() {
		this.memory = {
			ownedRoomSightings: {},
			claimedRoomSightings: {},
			creepSightings: {},
		};

		if (hivemind.segmentMemory.isReady()) {
			if (!hivemind.segmentMemory.has(memoryKey)) {
				hivemind.segmentMemory.set(memoryKey, this.memory);
			}
			else {
				this.mergeMemory();
			}
		}
	}

	mergeMemory() {
		const newMemory = hivemind.segmentMemory.get<PlayerIntelManagerMemory>(memoryKey);

		// @todo Merge instead of overwriting.
		this.memory = newMemory;
	}

	/**
	 * Factory method for player intel objects.
	 *
	 * @param {string} userName
	 *   The user for whom to get intel.
	 *
	 * @return {PlayerIntel}
	 *   The requested PlayerIntel object.
	 */
	get(userName: string): PlayerIntel {
		if (!hivemind.segmentMemory.isReady()) throw new Error('Memory is not ready to generate player intel for user "' + userName + '".');

		if (!this.intelCache[userName]) {
			this.intelCache[userName] = new PlayerIntel(userName);
		}

		return this.intelCache[userName];
	}

	updateOwnedRoom(userName: string, roomName: string) {
		if (!this.memory.ownedRoomSightings[userName]) this.memory.ownedRoomSightings[userName] = {};
		this.memory.ownedRoomSightings[userName][roomName] = Game.time;
	}

	updateClaimedRoom(userName: string, roomName: string) {
		if (!this.memory.claimedRoomSightings[userName]) this.memory.claimedRoomSightings[userName] = {};
		this.memory.claimedRoomSightings[userName][roomName] = Game.time;
	}

	updateCreepSighting(userName: string, roomName: string, creeps: Creep[]) {

	}
}
