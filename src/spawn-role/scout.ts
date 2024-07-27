/* global MOVE */

import container from 'utils/container';
import hivemind from 'hivemind';
import interShard from 'intershard';
import RoomStatus from 'room/room-status';
import SpawnRole from 'spawn-role/spawn-role';
import {decodePosition} from 'utils/serialization';

declare global {
	interface RoomMemory {
		recentScout: number;
	}

	interface ScoutSpawnOption extends SpawnOption {
		shard?: string;
		portalTarget?: string;
	}
}

// Minimum time between spawning 2 scouts in the same room.
const scoutSpawnThrottle = CREEP_LIFE_TIME / 3;

export default class ScoutSpawnRole extends SpawnRole {
	roomStatus: RoomStatus;

	constructor() {
		super();

		this.roomStatus = container.get('RoomStatus');
	}

	/**
	 * Adds scout spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): ScoutSpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 50, () => {
			const options: ScoutSpawnOption[] = [];
			this.addIntershardSpawnOptions(room, options);

			// Don't spawn scouts in quick succession.
			// If they die immediately, they might be running into enemies right outside
			// of the room.
			if (room.memory.recentScout && Game.time - (room.memory.recentScout || -scoutSpawnThrottle) < scoutSpawnThrottle) return options;

			const roomScouts = _.filter(Game.creepsByRole.scout, creep => creep.memory.origin === room.name);
			if (_.size(roomScouts) >= hivemind.settings.get('maxScoutsPerRoom') || !room.needsScout()) return options;

			const isEarlyGame = _.size(Game.myRooms) === 1 && !room.storage && !room.terminal;

			options.push({
				priority: isEarlyGame ? 4 : hivemind.settings.get('scoutSpawnPriority'),
				weight: isEarlyGame ? 1 : 0,
			});

			return options;
		});
	}

	/**
	 * Adds scout spawn options for intershard scouting.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addIntershardSpawnOptions(room: Room, options: ScoutSpawnOption[]) {
		// Check if a portal requires a scout and has this room as origin.
		const memory = interShard.getLocalMemory();

		_.each(memory.scouting, (isActive, shardName) => {
			_.each(memory.portals[shardName], (info, portalPos) => {
				if (info.scouted && Game.time - info.scouted < 2000) return;

				// Only spawn scout if we're responsible for the portal room.
				const pos = decodePosition(portalPos);
				if (this.roomStatus.getOrigin(pos.roomName) !== room.name) return;

				options.push({
					priority: hivemind.settings.get('scoutSpawnPriority'),
					weight: 0,
					shard: shardName,
					portalTarget: portalPos,
				});
			});
		});
	}

	/**
	 * Gets the body of a creep to be spawned.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {string[]}
	 *   A list of body parts the new creep should consist of.
	 */
	getCreepBody(): BodyPartConstant[] {
		return [MOVE];
	}

	/**
	 * Gets memory for a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepMemory(room: Room, option: ScoutSpawnOption): ScoutCreepMemory {
		const memory: ScoutCreepMemory = {
			role: 'scout',
			origin: room.name,
			disableNotifications: true,
		};

		if (option.portalTarget) {
			memory.portalTarget = option.portalTarget;
		}

		return memory;
	}

	/**
	 * Act when a creep belonging to this spawn role is successfully spawning.
	 *
	 * @param {Room} room
	 *   The room the creep is spawned in.
	 * @param {Object} option
	 *   The spawn option which caused the spawning.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 * @param {string} name
	 *   The name of the new creep.
	 */
	onSpawn(room: Room, option: ScoutSpawnOption) {
		if (!option.portalTarget) {
			room.memory.recentScout = Game.time;
			return;
		}

		// Store scout spawn time in intershard memory.
		const memory = interShard.getLocalMemory();
		memory.portals[option.shard][option.portalTarget].scouted = Game.time;
		interShard.writeLocalMemory();
	}
}
