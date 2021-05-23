'use strict';

/* global hivemind RoomPosition */

const Process = require('./process');
const utilities = require('./utilities');

/**
 * Displays map visuals.
 */
module.exports = class MapVisualsProcess extends Process {
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
		});

		_.each(_.filter(Memory.rooms, (mem, roomName) => !Memory.strategy.roomList[roomName]), (mem, roomName) => {
			if (typeof roomName !== 'string') return;
			this.drawIntelStatus(roomName);
		});

		this.drawNavMesh();
	}

	/**
	 * Marks how current our intel on a given room is.
	 *
	 * @param {string} roomName
	 *   Name of the room in question.
	 */
	drawIntelStatus(roomName) {
		const intel = hivemind.roomIntel(roomName);
		const age = intel.getAge();
		const color = age < 200 ? '#00ff00' : age < 2000 ? '#ffff00' : age < 10000 ? '#ff8888' : '#888888';

		Game.map.visual.text('•', new RoomPosition(3, 3, roomName), {color, fontSize: 10});
	}

	/**
	 * Visualizes expansion score for each room.
	 *
	 * @param {string} roomName
	 *   Name of the room in question.
	 */
	drawExpansionStatus(roomName) {
		const info = Memory.strategy.roomList[roomName];

		if (Memory.strategy.remoteHarvesting.rooms.indexOf(roomName) !== -1) {
			Game.map.visual.text('⛏', new RoomPosition(3, 3, roomName), {fontSize: 5});
		}

		if (!info.expansionScore) return;

		Game.map.visual.text(info.expansionScore.toPrecision(3), new RoomPosition(8, 4, roomName), {fontSize: 7, align: 'left'});
	}

	/**
	 * Visualizes nav mesh data.
	 */
	drawNavMesh() {
		if (!Memory.nav) return;
		_.each(Memory.nav.rooms, (navInfo, roomName) => {
			if (!navInfo.regions) {
				// Single region, all exits are connected.
				for (const exit of navInfo.exits) {
					Game.map.visual.line(new RoomPosition(25, 25, roomName), utilities.deserializePosition(exit.center, roomName));
				}

				return;
			}

			// Multiple regions, all exits are connected.
			for (const region of navInfo.regions) {
				for (const exit of navInfo.exits) {
					if (region.exits.indexOf(exit.id) === -1) continue;

					Game.map.visual.line(utilities.deserializePosition(region.center, roomName), utilities.deserializePosition(exit.center, roomName));
				}
			}
		});
	}
};
