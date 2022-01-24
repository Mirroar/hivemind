/* global RoomPosition */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import Process from 'process/process';
import {deserializePosition} from 'utils/serialization';
import {getRoomIntel} from 'intel-management';

// @todo Move constants to settings.
const enableMapVisuals = true;
const drawIntelStatus = false;
const drawMiningStatus = true;
const expansionScoreCutoff = 4;

/**
 * Displays map visuals.
 */
export default class MapVisualsProcess extends Process {
	/**
	 * Creates map visuals for our empire.
	 */
	run() {
		if (!enableMapVisuals || !Game.map.visual) return;

		let drawn = false;
		const visuals = cache.inHeap('map-visuals', 10, () => {
			this.drawExpansionStatus();

			// We need to check a combination of entries in room memory, and those
			// contained in Memory.strategy.roomList.
			_.each(Memory.strategy.roomList, (info, roomName) => {
				if (typeof roomName !== 'string') return;
				this.drawIntelStatus(roomName);
				this.drawRoomStatus(roomName);
			});

			_.each(_.filter(Memory.rooms, (mem, roomName) => !Memory.strategy?.roomList?.[roomName]), (mem, roomName) => {
				if (typeof roomName !== 'string') return;
				this.drawIntelStatus(roomName);
			});

			this.drawNavMesh();

			drawn = true;
			return Game.map.visual.export();
		});

		if (!drawn) Game.map.visual.import(visuals);
	}

	/**
	 * Marks how current our intel on a given room is.
	 *
	 * @param {string} roomName
	 *   Name of the room in question.
	 */
	drawIntelStatus(roomName) {
		if (!drawIntelStatus) return;
		if (!hivemind.segmentMemory.isReady()) return;

		const intel = getRoomIntel(roomName);
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
	drawRoomStatus(roomName) {
		const info = Memory.strategy.roomList[roomName];

		if (drawMiningStatus && (Memory.strategy.remoteHarvesting?.rooms || []).includes(roomName)) {
			Game.map.visual.text('⛏', new RoomPosition(3, 3, roomName), {fontSize: 5});
		}

		if (!info.expansionScore) return;
		if (info.expansionScore < expansionScoreCutoff) return;

		Game.map.visual.text(info.expansionScore.toPrecision(3), new RoomPosition(8, 4, roomName), {fontSize: 7, align: 'left'});
	}

	drawExpansionStatus() {
		if (!Memory.strategy.expand) return;

		// Visualize failed expansion attempts.
		for (const attempt of Memory.strategy.expand.failedExpansions || []) {
			Game.map.visual.circle(new RoomPosition(25, 25, attempt.roomName), {fill: '#ff0000', opacity: 0.2, radius: 25});
			Game.map.visual.circle(new RoomPosition(25, 25, attempt.roomName), {fill: '#ff0000', opacity: 0.2, radius: 125});
		}

		// Visualize current expansion target.
		if (Memory.strategy.expand.currentTarget) {
			const targetMemory = Memory.strategy.expand.currentTarget;
			const targetPosition = new RoomPosition(10, 10, targetMemory.roomName);

			for (const roomName of targetMemory.supportingRooms || []) {
				Game.map.visual.line(new RoomPosition(25, 25, roomName), targetPosition, {opacity: 0.35, lineStyle: 'dashed'});
			}

			Game.map.visual.line(new RoomPosition(25, 25, targetMemory.spawnRoom), targetPosition, {opacity: 0.5});
			Game.map.visual.text('🏴', targetPosition);
		}
	}

	/**
	 * Visualizes nav mesh data.
	 */
	drawNavMesh() {
		if (!hivemind.settings.get('visualizeNavMesh')) return;
		if (!Memory.nav) return;
		_.each(Memory.nav.rooms, (navInfo, roomName) => {
			if (!navInfo.regions) {
				// Single region, all exits are connected.
				for (const exit of navInfo.exits) {
					Game.map.visual.line(new RoomPosition(25, 25, roomName), deserializePosition(exit.center, roomName));
				}

				return;
			}

			// Multiple regions, all exits are connected.
			for (const region of navInfo.regions) {
				for (const exit of navInfo.exits) {
					if (region.exits.indexOf(exit.id) === -1) continue;

					Game.map.visual.line(deserializePosition(region.center, roomName), deserializePosition(exit.center, roomName));
				}
			}
		});
	}
};
