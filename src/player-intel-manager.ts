import PlayerIntel from './player-intel';
import hivemind from './hivemind';

export default class PlayerIntelManager {
	intelCache: Record<string, PlayerIntel> = {};

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

		playerIntel.updateOwnedRoom(roomName);
	}

	updateClaimedRoom(userName: string, roomName: string) {
		const playerIntel = this.get(userName);

		playerIntel.updateRemote(roomName);
	}

	updateCreepSighting(userName: string, roomName: string, creeps: Creep[]) {
		const playerIntel = this.get(userName);

		playerIntel.updateCreeps(creeps);
	}
}
