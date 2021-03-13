'use strict';

/* global hivemind */

const Process = require('./process');

/**
 * Displays map visuals.
 */
module.exports = class MapVisualsProcess extends Process {
  /**
   * Creates a new MapVisualsProcess object.
   *
   * @param {object} params
   *   Options on how to run this process.
   * @param {object} data
   *   Memory object allocated for this process' stats.
   */
  constructor(params, data) {
    super(params, data);

    // @todo Setup memory if necessary.
  }

  /**
   * Creates map visuals for our empire.
   */
  run() {
    // We need to check a combination of entries in room memory, and those
    // contained in Memory.strategy.roomList.
    _.each(Memory.strategy.roomList, (info, roomName) => {
      if (typeof roomName !== 'string') return;
      this.drawIntelStatus(roomName);
      this.drawExpansionStatus(roomName);
      this.drawInfluenceBorders(roomName);
    });

    _.each(_.filter(Memory.rooms, (mem, roomName) => !Memory.strategy.roomList[roomName]), (mem, roomName) => {
      if (typeof roomName !== 'string') return;
      this.drawIntelStatus(roomName);
    })
  }

  /**
   * Marks how current our intel on a given room is.
   */
  drawIntelStatus(roomName) {
    const intel = hivemind.roomIntel(roomName);
    const age = intel.getAge();
    const color = age < 200 ? '#00ff00' : age < 2000 ? '#ffff00' : age < 10000 ? '#ff8888' : '#888888';

    Game.map.visual.text('•', new RoomPosition(3, 3, roomName), {color, fontSize: 30});
  }

  /**
   * Visualizes expansion score for each room.
   */
  drawExpansionStatus(roomName) {
    const info = Memory.strategy.roomList[roomName];

    if (info.harvestActive) {
      Game.map.visual.text('⛏', new RoomPosition(3, 3, roomName), {fontSize: 5});
    }

    if (!info.expansionScore) return;

    Game.map.visual.text(info.expansionScore.toPrecision(3), new RoomPosition(8, 4, roomName), {fontSize: 7, align: 'left'});
  }

  /**
   * Visualizes origin for operations in a room.
   */
  drawInfluenceBorders(roomName) {
    // @todo
  }
};
