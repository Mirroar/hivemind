import container from 'utils/container';
import Process from 'process/process';
import hivemind from 'hivemind';
import ReclaimManager from 'reclaim-manager';

export default class ReclaimProcess extends Process {
	manager: ReclaimManager;

	constructor(parameters: ProcessParameters) {
		super(parameters);
		this.manager = container.get('ReclaimManager');
	}

	/**
	 * Sends builders to destroyed rooms we still have control over.
	 */
	run() {
		this.markReclaimableRooms();
		this.manager.cleanReclaimMemory();
	}

	/**
	 * Keeps a record of reclaimable rooms.
	 */
	markReclaimableRooms() {
		for (const room of Game.myRooms) {
			this.manager.updateReclaimStatus(room);
		}
	}

}
