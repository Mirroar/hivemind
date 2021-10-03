declare global {
  interface RoomMemory {
    isReclaimableSince: number,
  }
}

import hivemind from 'hivemind';
import Process from 'process/process';

export default class ReclaimProcess extends Process {
  /**
   * Sends builders to destroyed rooms we still have control over.
   */
  run() {
    this.detectReclaimableRooms();
  }

  /**
   * Keeps a record of reclaimable rooms.
   */
  detectReclaimableRooms() {
    for (const room of Game.myRooms) {
      if (room.find(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_SPAWN
      }).length > 0) {
        if (room.memory.isReclaimableSince && room.roomManager && room.roomManager.checkWallIntegrity()) {
          // Room has finished rebuilding.
          delete room.memory.isReclaimableSince;
        }

        continue;
      }

      if (!room.memory.isReclaimableSince) room.memory.isReclaimableSince = Game.time;

      for (const username in room.enemyCreeps) {
        if (!hivemind.relations.isAlly(username)) {
          room.memory.isReclaimableSince = Game.time;
          break;
        }
      }
    }
  }
}
