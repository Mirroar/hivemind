'use strict';

/* global RoomPosition ERR_NO_PATH FIND_SOURCES FIND_FLAGS FIND_STRUCTURES
FIND_CONSTRUCTION_SITES STRUCTURE_SPAWN FIND_MY_STRUCTURES RESOURCE_ENERGY
ERR_NOT_IN_RANGE STRUCTURE_RAMPART FIND_MY_CONSTRUCTION_SITES STRUCTURE_TOWER
FIND_DROPPED_RESOURCES STRUCTURE_CONTAINER FIND_SOURCES_ACTIVE */

const utilities = require('./utilities');

const roleRemoteBuilder = {

	/** @param {Creep} creep **/
	run(creep) {
		if (creep.memory.starting) {
			if (_.sum(creep.carry) < creep.carryCapacity) {
				return creep.performGetEnergy();
			}

			delete creep.memory.starting;
		}

		if (!creep.memory.building && creep.memory.extraEnergyTarget) {
			if (_.sum(creep.carry) >= creep.carryCapacity) {
				delete creep.memory.extraEnergyTarget;
				return true;
			}

			const pos = utilities.decodePosition(creep.memory.extraEnergyTarget);
			if (creep.pos.getRangeTo(pos) > 1) {
				if (creep.moveTo(pos) === ERR_NO_PATH) {
					delete creep.memory.extraEnergyTarget;
				}
			}
			else {
				const source = creep.pos.findClosestByRange(FIND_SOURCES);
				creep.harvest(source);
				if (source.energy <= 0) {
					delete creep.memory.extraEnergyTarget;
				}
			}

			return true;
		}

		if (!creep.memory.extraEnergyTarget && creep.memory.sourceRoom) {
			if (creep.pos.roomName === creep.memory.sourceRoom) {
				delete creep.memory.sourceRoom;
			}
			else {
				creep.moveToRange(new RoomPosition(25, 25, creep.memory.sourceRoom), 5);
			}

			return true;
		}

		const targetPosition = utilities.decodePosition(creep.memory.target);
		if (targetPosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(targetPosition, 5);
			return true;
		}

		if (creep.memory.building && creep.carry.energy === 0) {
			creep.memory.building = false;
			delete creep.memory.buildTarget;
			delete creep.memory.repairTarget;
			delete creep.memory.tempRole;
			delete creep.memory.upgrading;
		}
		else if (!creep.memory.building && creep.carry.energy === creep.carryCapacity) {
			creep.memory.building = true;
			delete creep.memory.resourceTarget;
			delete creep.memory.tempRole;
		}

		if (creep.memory.building) {
			// Try and prevent controller downgrades.
			if ((creep.room.controller && creep.room.controller.level < 2) || (creep.room.controller.my && creep.room.controller.ticksToDowngrade < 500)) {
				creep.memory.upgrading = true;
			}

			if (creep.room.controller.level === 0) {
				creep.memory.upgrading = false;
			}

			if (!creep.memory.upgrading) {
				// Check for claim flags.
				const claimFlags = creep.room.find(FIND_FLAGS, {
					filter: flag => flag.name.startsWith('ClaimRoom'),
				});
				if (claimFlags && claimFlags.length > 0) {
					// Check if room has a spawner by now.
					const spawners = creep.room.find(FIND_STRUCTURES, {
						filter: structure => structure.structureType === STRUCTURE_SPAWN,
					});

					if (!spawners || spawners.length <= 0) {
						// Check if room has a spawner construction site by now.
						const spawners = creep.room.find(FIND_CONSTRUCTION_SITES, {
							filter: site => site.structureType === STRUCTURE_SPAWN,
						});

						if (!spawners || spawners.length <= 0) {
							// Create construction site for spawner.
							claimFlags[0].pos.createConstructionSite(STRUCTURE_SPAWN);
						}
					}
					else {
						// Spawner exists, claim flag can be removed.
						claimFlags[0].remove();
					}
				}

				// Help by filling spawn with energy.
				const spawns = creep.room.find(FIND_MY_STRUCTURES, {
					filter: structure => structure.structureType === STRUCTURE_SPAWN,
				});
				if (spawns && spawns.length > 0 && spawns[0].energy < spawns[0].energyCapacity * 0.8) {
					if (creep.transfer(spawns[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
						creep.moveToRange(spawns[0], 1);
					}

					return true;
				}

				if (!creep.memory.repairTarget) {
					// Make sure ramparts don't break.
					const targets = creep.room.find(FIND_MY_STRUCTURES, {
						filter: structure => structure.structureType === STRUCTURE_RAMPART && structure.hits < 10000,
					});
					if (targets.length > 0) {
						creep.memory.repairTarget = targets[0].id;
					}
				}

				if (creep.memory.repairTarget) {
					const target = Game.getObjectById(creep.memory.repairTarget);
					if (!target || (target.structureType === STRUCTURE_RAMPART && target.hits > 15000)) {
						delete creep.memory.repairTarget;
					}

					if (creep.repair(target) === ERR_NOT_IN_RANGE) {
						creep.moveToRange(target, 3);
					}

					return true;
				}

				// Build structures.
				const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
				if (targets.length > 0) {
					if (!creep.memory.buildTarget) {
						creep.memory.resourceTarget = null;

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

					const best = creep.memory.buildTarget;
					if (!best) {
						return false;
					}

					const target = Game.getObjectById(best);
					if (!target) {
						creep.memory.buildTarget = null;
					}

					if (creep.build(target) === ERR_NOT_IN_RANGE) {
						if (!creep.moveToRange(target, 3)) {
							creep.memory.buildTarget = null;
							return false;
						}
					}

					return true;
				}
			}

			// Otherwise, upgrade controller.
			creep.memory.upgrading = true;
			if (creep.pos.getRangeTo(creep.room.controller) > 3) {
				creep.moveToRange(creep.room.controller, 3);
			}
			else {
				creep.upgradeController(creep.room.controller);
			}

			return false;
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

			return true;
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

				return true;
			}

			// Try get energy from a source.
			const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
			if (source) {
				creep.memory.resourceTarget = source.id;
				creep.memory.deliverTarget = null;
			}
			else {
				// Or even get energy from adjacent rooms if marked.
				const flags = _.filter(Game.flags, flag => flag.name.startsWith('ExtraEnergy:' + creep.pos.roomName));
				if (flags.length > 0) {
					const flag = _.sample(flags);
					creep.memory.extraEnergyTarget = utilities.encodePosition(flag.pos);
					creep.memory.sourceRoom = creep.pos.roomName;
					return true;
				}

				creep.performGetEnergy();
				return true;
			}
		}

		const best = creep.memory.resourceTarget;
		if (!best) {
			return false;
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

				const flags = _.filter(Game.flags, flag => flag.name.startsWith('ExtraEnergy:' + creep.pos.roomName));
				if (flags.length > 0) {
					const flag = _.sample(flags);
					creep.memory.extraEnergyTarget = utilities.encodePosition(flag.pos);
					creep.memory.sourceRoom = creep.pos.roomName;
					return true;
				}
			}
		}

		return true;
	},

};

module.exports = roleRemoteBuilder;
