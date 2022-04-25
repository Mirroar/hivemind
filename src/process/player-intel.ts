import Process from 'process/process';
import {getPlayerIntel} from 'player-intel';
import {getRoomIntel, getRoomsWithIntel} from 'room-intel';

export default class PlayerIntelProcess extends Process {
	run() {
		const playerRooms = this.collectPlayerRooms();

		for (const userName in playerRooms) {
			const playerIntel = getPlayerIntel(userName);
			playerIntel.setPlayerRooms(playerRooms[userName].owned);
			playerIntel.setPlayerRemotes(playerRooms[userName].remotes);
		}
	}

  collectPlayerRooms() {
    const availableRooms = getRoomsWithIntel();
    const result: {
      [userName: string]: {
        owned: string[],
        remotes: string[],
      }
    } = {};
    for (const roomName of availableRooms) {
      const roomIntel = getRoomIntel(roomName);

			if (roomIntel.isOwned()) {
				const userName = roomIntel.getOwner();
				if (!result[userName]) result[userName] = {owned: [], remotes: []};

				result[userName].owned.push(roomName);
			}
			else if (roomIntel.isClaimed()) {
				const userName = roomIntel.getReservationStatus().username;
				if (!result[userName]) result[userName] = {owned: [], remotes: []};

				result[userName].remotes.push(roomName);
			}
			else {
				// @todo Try and detect harvester creeps.
			}
		}

		return result;
	}
}
