import Process from 'process/process';
import container from 'utils/container';
import PlayerIntelManager from 'player-intel-manager';
import {getRoomIntel, getRoomsWithIntel} from 'room-intel';

export default class PlayerIntelProcess extends Process {
	run() {
		const manager = container.get<PlayerIntelManager>('PlayerIntelManager');
		this.collectPlayerRooms(manager);
	}

	collectPlayerRooms(manager: PlayerIntelManager) {
		const availableRooms = getRoomsWithIntel();
		for (const roomName of availableRooms) {
			const roomIntel = getRoomIntel(roomName);

			if (roomIntel.isOwned()) {
				const userName = roomIntel.getOwner();
				manager.updateOwnedRoom(userName, roomName);
			}
			else if (roomIntel.isClaimed()) {
				const userName = roomIntel.getReservationStatus().username;
				manager.updateClaimedRoom(userName, roomName);
			}

			if (Game.rooms[roomName]) {
				const room = Game.rooms[roomName];
				for (const userName in room.enemyCreeps) {
					manager.updateCreepSighting(userName, roomName, room.enemyCreeps[userName]);
				}
			}
		}
	}
}
