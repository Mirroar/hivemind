/* global STRUCTURE_ROAD OK RESOURCE_ENERGY LOOK_CREEPS
STRUCTURE_CONTAINER FIND_SOURCES LOOK_CONSTRUCTION_SITES
FIND_MY_CONSTRUCTION_SITES */

import container from 'utils/container';
import hivemind from 'hivemind';
import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {decodePosition, serializePositionPath} from 'utils/serialization';

declare global {
	interface SkKillerCreep extends Creep {
		memory: SkKillerCreepMemory;
		heapMemory: SkKillerCreepHeapMemory;
		operation: RemoteMiningOperation;
	}

	interface SkKillerCreepMemory extends CreepMemory {
		role: 'skKiller';
		targetRoom: string;
	}

	interface SkKillerCreepHeapMemory extends CreepHeapMemory {
		targetCreep: Id<Creep>;
	}
}

export default class RemoteHarvesterRole extends Role {
	constructor() {
		super();

		// Sk Killers have slighly higher priority, so they can protect their
		// harvesters.
		this.throttleAt = 5000;
		this.stopAt = 2000;
	}

	/**
	 * Makes a creep behave like a sk killer.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: SkKillerCreep) {
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home and suicide?
			return;
		}

		if (this.travelToTargetRoom(creep)) return;

		this.performSkSlaughter(creep);
	}

	/**
	 * Makes the creep move toward its targeted source.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @returns {boolean}
	 *   Whether the creep is in the process of moving.
	 */
	travelToTargetRoom(creep: SkKillerCreep) {
		if (creep.pos.roomName === creep.operation.getRoom()) return false;

		if (!creep.hasCachedPath()) {
			const paths = creep.operation.getPaths();
			const path = _.min(_.filter(paths, path => path.accessible), path => path.travelTime ?? 500);

			if (path) creep.setCachedPath(serializePositionPath(path.path), true, 1);
		}

		if (creep.hasCachedPath()) {
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else {
				creep.followCachedPath();
				return true;
			}
		}

		const targetPosition = new RoomPosition(25, 25, creep.operation.getRoom());
		return creep.interRoomTravel(targetPosition);
	}

	/**
	 * Makes the creep harvest resources outside of owned rooms.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performSkSlaughter(creep: SkKillerCreep) {
		if (creep.pos.roomName !== creep.operation.getRoom()) return;
		creep.memory.singleRoom = creep.operation.getRoom();

		const sourceKeepers = [];
		const otherEnemies = [];
		const room = creep.room;

		// Filter hostiles.
		for(const owner in room.enemyCreeps) {
			if (hivemind.relations.isAlly(owner)) continue;

			// Count body parts for strength estimation.
			for (const creep of room.enemyCreeps[owner]) {
				if (!creep.isDangerous()) continue;

				if (
					creep.owner.username === 'Source Keeper'
					&& _.min(_.map(room.structuresByType[STRUCTURE_KEEPER_LAIR], (s: StructureKeeperLair) => s.pos.getRangeTo(creep.pos))) <= 5
				) {
					const closestLair = _.min(room.structuresByType[STRUCTURE_KEEPER_LAIR], (s: StructureKeeperLair) => s.pos.getRangeTo(creep.pos));
					const closestResource = _.min([...room.sources, ...room.minerals], (s: Source | Mineral) => s.pos.getRangeTo(closestLair.pos));
					// @todo Only ignore mineral source keepers if we're not
					// mining that mineral.
					if (closestResource instanceof Mineral) continue;

					sourceKeepers.push(creep);
					continue;
				}

				otherEnemies.push(creep);
			}
		}

		if (otherEnemies.length > 0) {
			// @todo We might have to do some defending.
			delete creep.heapMemory.targetCreep;

			const combatManager = container.get('CombatManager');
			combatManager.manageCombatActions(creep);
			combatManager.performKitingMovement(creep, combatManager.getMostValuableTarget(creep));

			return;
		}

		// @todo Consider healing nearby injured creeps.
		const hasHealed = creep.hits < creep.hitsMax && creep.heal(creep) === OK;

		if (sourceKeepers.length > 0) {
			const target = this.getTargetSourceKeeper(creep, sourceKeepers);
			creep.whenInRange(1, target, () => {
				// Don't try to heal and attack at the same time. We rely on
				// reflected damage.
				if (!hasHealed) creep.attack(target);
			});

			return;
		}

		// If there's no current target, move to SK lair with soonest respawn.
		const nextLair = _.min(room.structuresByType[STRUCTURE_KEEPER_LAIR], (s: StructureKeeperLair) => s.ticksToSpawn);
		creep.whenInRange(1, nextLair, () => {
			// Stand around menacingly.
		});
	}

	getTargetSourceKeeper(creep: SkKillerCreep, sourceKeepers: Creep[]): Creep {
		if (creep.heapMemory.targetCreep) {
			const target = Game.getObjectById(creep.heapMemory.targetCreep);

			if (target) return target;
		}

		const target = _.min(sourceKeepers, c => c.pos.getRangeTo(creep.pos));
		creep.heapMemory.targetCreep = target.id;

		return target;
	}
}
