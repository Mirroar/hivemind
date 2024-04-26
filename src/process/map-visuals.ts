/* global RoomPosition */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import Process from 'process/process';
import RemotePathManager from 'empire/remote-path-manager';
import {deserializePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

// @todo Move constants to settings.
const drawIntelStatus = false;
const drawMiningStatus = true;

/**
 * Displays map visuals.
 */
export default class MapVisualsProcess extends Process {
	/**
	 * Creates map visuals for our empire.
	 */
	run() {
		if (hivemind.settings.get('disableMapVisuals') || !Game.map.visual) return;

		let drawn = false;
		const visuals = cache.inHeap('map-visuals', 10, () => {
			this.drawExpansionStatus();

			// We need to check a combination of entries in room memory, and those
			// contained in Memory.strategy.roomList.
			_.each(Memory.strategy.roomList, (info, roomName) => {
				if (typeof roomName !== 'string') return;

				this.drawIntelStatus(roomName);
				this.drawRoomStatus(roomName);
				this.drawRemoteMinePaths(roomName);
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
	drawIntelStatus(roomName: string) {
		if (!drawIntelStatus) return;
		if (!hivemind.segmentMemory.isReady()) return;

		const intel = getRoomIntel(roomName);
		const age = intel.getAge();
		const color = age < 200 ? '#00ff00' : (age < 2000 ? '#ffff00' : age < 10_000 ? '#ff8888' : '#888888');

		Game.map.visual.text('•', new RoomPosition(3, 3, roomName), {color, fontSize: 10});
	}

	/**
	 * Visualizes expansion score for each room.
	 *
	 * @param {string} roomName
	 *   Name of the room in question.
	 */
	drawRoomStatus(roomName: string) {
		const info = Memory.strategy.roomList[roomName];

		if (drawIntelStatus && info.scoutPriority > 0) {
			Game.map.visual.text(info.scoutPriority.toPrecision(2), new RoomPosition(3, 23, roomName), {fontSize: 5});
			Game.map.visual.line(new RoomPosition(25, 25, roomName), new RoomPosition(25, 25, info.origin), {opacity: 0.5, width: 1});
		}

		if (!info.expansionScore) return;
		if (info.expansionScore < this.getExpansionScoreCutoff()) return;

		Game.map.visual.text(info.expansionScore.toPrecision(3), new RoomPosition(8, 4, roomName), {fontSize: 7, align: 'left'});
	}

	getExpansionScoreCutoff(): number {
		return cache.inHeap('expansionScoreCutoff', 5000, () => {
			return _.max(_.map(Memory.strategy?.roomList ?? {}, (info, roomName) => {
				if (Game.rooms[roomName]?.isMine()) return 0;

				return info.expansionScore ?? 0;
			})) - 0.5;
		});
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

	drawRemoteMinePaths(roomName: string) {
		const info = Memory.strategy.roomList[roomName];
		if ((info?.harvestPriority ?? 0) <= 0.1) return;

		if (drawMiningStatus && (Memory.strategy.remoteHarvesting?.rooms || []).includes(roomName)) {
			Game.map.visual.text('⛏', new RoomPosition(3, 3, roomName), {fontSize: 5});
		}

		Game.map.visual.text(info.harvestPriority.toPrecision(3), new RoomPosition(7, 3, roomName), {fontSize: 5, align: 'left'});

		const remotePathManager = new RemotePathManager();
		const intel = getRoomIntel(roomName);
		for (const coords of intel.getSourcePositions()) {
			const position = new RoomPosition(coords.x, coords.y, roomName);
			const path = remotePathManager.getPathFor(position);
			if (!path) {
				Game.map.visual.text('?', position, {color: '#ff0000', fontSize: 5});
				continue;
			}

			Game.map.visual.poly(path, {
				opacity: 0.3,
				stroke: '#00ffff',
			});
		}
	}

	/**
	 * Visualizes nav mesh data.
	 */
	drawNavMesh() {
		if (!hivemind.settings.get('visualizeNavMesh')) return;
		if (!Memory.nav) return;
		_.each(Memory.nav.rooms, (navInfo, roomName) => {
			const roomIntel = getRoomIntel(roomName);
			let color = '#ffffff';
			if (roomIntel.isOwned()) {
				color = '#ff0000';
			}
			else if (roomIntel.isClaimed()) {
				color = '#ffff00';
			}
			else if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
				color = '#ff8000';
			}

			const style = {
				color,
				opacity: 1,
				width: 2,
				lineStyle: 'dotted' as const,
			};

			for (const portal of navInfo.portals || []) {
				Game.map.visual.line(new RoomPosition(25, 25, portal.room), new RoomPosition(25, 25, roomName), {...style, color: '#8080ff', width: 1});
			}

			if (!navInfo.regions) {
				// Single region, all exits are connected.
				for (const exit of navInfo.exits) {
					Game.map.visual.line(new RoomPosition(25, 25, roomName), deserializePosition(exit.center, roomName), style);
				}

				return;
			}

			// Multiple regions, all exits are connected.
			for (const region of navInfo.regions) {
				for (const exit of navInfo.exits) {
					if (!region.exits.includes(exit.id)) continue;

					Game.map.visual.line(deserializePosition(region.center, roomName), deserializePosition(exit.center, roomName), style);
				}
			}
		});
	}
}
