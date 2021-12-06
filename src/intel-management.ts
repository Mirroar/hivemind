import hivemind from 'hivemind';
import PlayerIntel from 'player-intel';
import RoomIntel from 'room-intel';

const intelCache: {
  rooms: {
    [roomName: string]: RoomIntel;
  };
  players: {
    [userName: string]: PlayerIntel;
  }
} = {
  rooms: {},
  players: {},
};

/**
 * Factory method for player intel objects.
 *
 * @param {string} userName
 *   The user for whom to get intel.
 *
 * @return {PlayerIntel}
 *   The requested PlayerIntel object.
 */
function getPlayerIntel(userName: string): PlayerIntel {
  if (!hivemind.segmentMemory.isReady()) throw new Error('Memory is not ready to generate player intel for user ' + userName + '.');

  if (!intelCache.players[userName]) {
    intelCache.players[userName] = new PlayerIntel(userName);
  }

  return intelCache.players[userName];
}

/**
 * Factory method for room intel objects.
 *
 * @param {string} roomName
 *   The room for which to get intel.
 *
 * @return {RoomIntel}
 *   The requested RoomIntel object.
 */
function getRoomIntel(roomName: string): RoomIntel {
  if (!hivemind.segmentMemory.isReady()) throw new Error('Memory is not ready to generate room intel for room ' + roomName + '.');

  if (!intelCache.rooms[roomName]) {
    intelCache.rooms[roomName] = new RoomIntel(roomName);
  }

  return intelCache.rooms[roomName];
}

export {
  getPlayerIntel,
  getRoomIntel,
}
