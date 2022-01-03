import Process from 'process/process';
import {getPlayerIntel, getRoomIntel, getRoomsWithIntel} from 'intel-management';

export default class PlayerIntelProcess extends Process {
  run() {
    const playerRooms = this.collectPlayerRooms();

    for (const userName in playerRooms) {
      const playerIntel = getPlayerIntel(userName);
      playerIntel.setPlayerRooms(playerRooms[userName].owned);
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
    }

    return result;
  }
}
