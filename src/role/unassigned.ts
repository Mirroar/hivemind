/* global CLAIM WORK */

import interShard from 'intershard';
import Role from 'role/role';

export default class UnassignedRole extends Role {
	/**
	 * Assigns a new role to this creep.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: Creep) {
		// Make this creep a scout by default.
		creep.memory = {
			role: 'scout',
			origin: creep.room.name,
		};

		// Creeps with claim parts are sent as part of intershard expansion.
		if (creep.getActiveBodyparts(CLAIM) > 0 || creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
			creep.memory.role = 'brawler';
			creep.memory.squadUnitType = 'singleClaim';
			creep.memory.squadName = 'interShardExpansion';
		}

		// Creeps with work parts are sent as part of intershard expansion.
		if (creep.getActiveBodyparts(WORK) > 0) {
			creep.memory.role = 'brawler';
			creep.memory.squadUnitType = 'builder';
			creep.memory.squadName = 'interShardExpansion';
		}

		this.detectReclaimCreep(creep);
	}

	detectReclaimCreep(creep: Creep) {
		for (const room of Game.myRooms) {
			if (!room.needsReclaiming()) continue;
			if (!room.isSafeForReclaiming()) continue;
			if (!Game.squads['intershardReclaim:' + room.name]) continue;

			const interShardMemory = interShard.getLocalMemory();
			if (!interShardMemory.info.rooms.reclaimable) continue;

			const reclaimRequest = _.find(interShardMemory.info.rooms.reclaimable, (info: any) => info.portalRoom === creep.pos.roomName);
			if (!reclaimRequest) continue;

			creep.memory.squadName = 'intershardReclaim:' + room.name;
			break;
		}
	}
}
