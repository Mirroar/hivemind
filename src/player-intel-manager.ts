import PlayerIntel from './player-intel';
import hivemind from './hivemind';

const memoryKey = 'player-intel-manager';

interface PlayerIntelManagerMemory {
};

export default class PlayerIntelManager {
	intelCache: Record<string, PlayerIntel> = {};
	memory: PlayerIntelManagerMemory;

	constructor() {
		if (!hivemind.segmentMemory.isReady()) throw new Error('Memory is not ready to generate player intel for user "' + userName + '".');

		if (!hivemind.segmentMemory.has(memoryKey)) {
			hivemind.segmentMemory.set(memoryKey, {
			});
		}

		this.memory = hivemind.segmentMemory.get<PlayerIntelManagerMemory>(memoryKey);
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
		const playerIntel = this.get(userName);

		playerIntel.trackOwnedRoom(roomName);
	}

	updateClaimedRoom(userName: string, roomName: string) {
		const playerIntel = this.get(userName);

		playerIntel.trackRemote(roomName);
	}

	updateCreepSighting(userName: string, roomName: string, creeps: Creep[]) {

	}
}
