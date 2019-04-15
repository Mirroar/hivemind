'use strict';

/* global ERR_NO_PATH FIND_SOURCES FIND_STRUCTURES STRUCTURE_SPAWN
FIND_MY_STRUCTURES RESOURCE_ENERGY ERR_NOT_IN_RANGE STRUCTURE_RAMPART
FIND_MY_CONSTRUCTION_SITES STRUCTURE_TOWER FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER FIND_SOURCES_ACTIVE */

const utilities = require('./utilities');

const roleRemoteBuilder = {

	/**
	 * Runs logic for remote builder creeps.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		this.creep = creep;

		if (creep.memory.building && creep.carry.energy === 0) {
			this.setBuilderState(false);
		}
		else if (!creep.memory.building && creep.carry.energy === creep.carryCapacity) {
			this.setBuilderState(true);
		}

		if (creep.memory.upgrading) {
			this.performControllerUpgrade();
			return;
		}

		if (creep.memory.building) {
			this.performRemoteBuild();
			return;
		}

		this.performGetRemoteBuilderEnergy();
	},

	/**
	 * Puts this creep into or out of build mode.
	 *
	 * @param {boolean} building
	 *   Whether to start building / repairing or not.
	 */
	setBuilderState(building) {
		this.creep.memory.building = building;
		delete this.creep.memory.buildTarget;
		delete this.creep.memory.repairTarget;
		delete this.creep.memory.resourceTarget;
		delete this.creep.memory.upgrading;
	},

	/**
	 * Spends energy in target room by building, repairing or upgrading.
	 */
	performRemoteBuild() {
		const creep = this.creep;

		// Try and prevent controller downgrades.
		if (creep.room.controller && creep.room.controller.my && (creep.room.controller.level < 2 || creep.room.controller.ticksToDowngrade < 500)) {
			creep.memory.upgrading = true;
			return;
		}

		// Help by filling spawn with energy.
		const spawns = creep.room.find(FIND_MY_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_SPAWN,
		});
		if (spawns && spawns.length > 0 && spawns[0].energy < spawns[0].energyCapacity * 0.8) {
			if (creep.transfer(spawns[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
				creep.moveToRange(spawns[0], 1);
			}

			return;
		}

		if (this.saveExpiringRamparts()) return;

		// Build structures.
		const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
		if (!creep.memory.buildTarget) {
			// Build spawns before building anything else.
			const spawnSites = _.filter(targets, structure => structure.structureType === STRUCTURE_SPAWN);
			if (spawnSites.length > 0) {
				creep.memory.buildTarget = spawnSites[0].id;
			}
			else {
				// Towers are also very important.
				const towerSites = _.filter(targets, structure => structure.structureType === STRUCTURE_TOWER);
				if (towerSites.length > 0) {
					creep.memory.buildTarget = towerSites[0].id;
				}
				else {
					const target = creep.pos.findClosestByPath(targets);
					if (target) {
						creep.memory.buildTarget = target.id;
					}
				}
			}
		}

		const target = Game.getObjectById(creep.memory.buildTarget);
		if (target) {
			if (creep.pos.getRangeTo(target) > 3) {
				creep.moveToRange(target, 3);
			}
			else {
				creep.build(target);
			}

			return;
		}

		// Otherwise, upgrade controller.
		delete creep.memory.buildTarget;
		creep.memory.upgrading = true;
	},

	/**
	 * Repairs ramparts that are low on hits, so they don't decay.
	 *
	 * @return {boolean}
	 *   True if we're trying to repair ramparts.
	 */
	saveExpiringRamparts() {
		if (!this.creep.memory.repairTarget) {
			// Make sure ramparts don't break.
			const targets = this.creep.room.find(FIND_MY_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_RAMPART && structure.hits < 10000,
			});
			if (targets.length > 0) {
				this.creep.memory.repairTarget = targets[0].id;
			}
		}

		if (this.creep.memory.repairTarget) {
			const target = Game.getObjectById(this.creep.memory.repairTarget);
			if (!target || (target.structureType === STRUCTURE_RAMPART && target.hits > 15000)) {
				delete this.creep.memory.repairTarget;
			}

			if (this.creep.repair(target) === ERR_NOT_IN_RANGE) {
				this.creep.moveToRange(target, 3);
			}

			return true;
		}

		return false;
	},

	/**
	 * Upgrades the room's controller.
	 */
	performControllerUpgrade() {
		if (this.creep.room.controller.level === 0) {
			this.creep.memory.upgrading = false;
			return;
		}

		if (this.creep.pos.getRangeTo(this.creep.room.controller) > 3) {
			this.creep.moveToRange(this.creep.room.controller, 3);
		}
		else {
			this.creep.upgradeController(this.creep.room.controller);
		}
	},

	/**
	 * Collects energy.
	 */
	performGetRemoteBuilderEnergy() {
		const creep = this.creep;
		if (creep.memory.extraEnergyTarget) {
			this.collectExtraEnergy();
			return;
		}

		if (!creep.memory.extraEnergyTarget && creep.memory.sourceRoom) {
			// Return to source room.
			if (creep.pos.roomName === creep.memory.sourceRoom) {
				delete creep.memory.sourceRoom;
			}
			else {
				creep.moveToRoom(creep.memory.sourceRoom);
				return;
			}
		}

		// Move to source room if necessary.
		const targetPosition = utilities.decodePosition(creep.memory.target);
		if (targetPosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(targetPosition, 5);
			return;
		}

		const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
			filter: drop => drop.resourceType === RESOURCE_ENERGY && (drop.amount > creep.carryCapacity * 0.3 || creep.pos.getRangeTo(drop) <= 1),
		});
		if (dropped) {
			if (creep.pos.getRangeTo(dropped) > 1) {
				creep.moveToRange(dropped, 1);
			}
			else {
				creep.pickup(dropped);
			}

			return;
		}

		if (!creep.memory.resourceTarget) {
			// Try getting energy from full containers.
			const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER && (structure.store.energy || 0) > 500,
			});
			if (container) {
				if (creep.pos.getRangeTo(container) > 1) {
					creep.moveToRange(container, 1);
				}
				else {
					creep.withdraw(container, RESOURCE_ENERGY);
				}

				return;
			}

			// Try get energy from a source.
			const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
			if (source) {
				creep.memory.resourceTarget = source.id;
				delete creep.memory.deliverTarget;
			}
			else {
				// Or even get energy from adjacent rooms if marked.
				const flags = _.filter(Game.flags, flag => flag.name.startsWith('ExtraEnergy:' + creep.pos.roomName));
				if (flags.length > 0) {
					const flag = _.sample(flags);
					creep.memory.extraEnergyTarget = utilities.encodePosition(flag.pos);
					creep.memory.sourceRoom = creep.pos.roomName;
					return;
				}

				creep.performGetEnergy();
				return;
			}
		}

		const best = creep.memory.resourceTarget;
		if (!best) {
			return;
		}

		const source = Game.getObjectById(best);
		if (!source || source.energy <= 0) {
			creep.memory.resourceTarget = null;
		}

		const result = creep.harvest(source);
		if (result === ERR_NOT_IN_RANGE) {
			const result = creep.moveToRange(source, 1);
			if (!result) {
				creep.memory.resourceTarget = null;

				// @todo Automatically assign sources of adjacent safe rooms as extra
				// energy targets.
				// const flags = _.filter(Game.flags, flag => flag.name.startsWith('ExtraEnergy:' + creep.pos.roomName));
				// if (flags.length > 0) {
				// 	const flag = _.sample(flags);
				// 	creep.memory.extraEnergyTarget = utilities.encodePosition(flag.pos);
				// 	creep.memory.sourceRoom = creep.pos.roomName;
				// }
			}
		}
	},

	/**
	 * Collects energy from extra energy sources from adjacent rooms.
	 */
	collectExtraEnergy() {
		if (_.sum(this.creep.carry) >= this.creep.carryCapacity) {
			delete this.creep.memory.extraEnergyTarget;
			return;
		}

		const pos = utilities.decodePosition(this.creep.memory.extraEnergyTarget);
		if (this.creep.pos.getRangeTo(pos) > 1) {
			if (this.creep.moveTo(pos) === ERR_NO_PATH) {
				delete this.creep.memory.extraEnergyTarget;
				return;
			}
		}

		const source = this.creep.pos.findClosestByRange(FIND_SOURCES);
		this.creep.harvest(source);
		if (source.energy <= 0) {
			delete this.creep.memory.extraEnergyTarget;
		}
	},

};

module.exports = roleRemoteBuilder;
