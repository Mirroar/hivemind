/* global FIND_MY_STRUCTURES STRUCTURE_TOWER FIND_HOSTILE_CREEPS FIND_MY_CREEPS
HEAL */

import hivemind from './hivemind';
import Process from './process';

/**
 * Manage defenses in a room.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const RoomDefenseProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

RoomDefenseProcess.prototype = Object.create(Process.prototype);

/**
 * Manages defenses.
 */
RoomDefenseProcess.prototype.run = function () {
	this.manageTowers();
	this.manageSafeMode();
	this.room.defense.openRampartsToFriendlies();
};

/**
 * Manages this room's towers.
 */
RoomDefenseProcess.prototype.manageTowers = function () {
	const towers = this.room.find(FIND_MY_STRUCTURES, {
		filter: structure => (structure.structureType === STRUCTURE_TOWER) && structure.energy > 0,
	});

	if (towers.length === 0) return;

	const hostileCreeps = this.room.find(FIND_HOSTILE_CREEPS);
	for (const tower of towers) {
		// Attack enemies.
		if (hostileCreeps.length > 0) {
			// Use new military manager if possible.
			const target = this.room.getTowerTarget(tower);
			if (!target) continue;

			if (target.my) {
				tower.heal(target);
			}
			else {
				tower.attack(target);
			}
		}

		// Heal friendlies.
		// @todo Don't check this for every tower in the room.
		const damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
			filter: creep => creep.hits < creep.hitsMax,
		});
		if (damaged) {
			tower.heal(damaged);
		}

		// Repair ramparts during a strong attack.
		if (this.room.defense.getEnemyStrength() > 1 && tower.store.getUsedCapacity() > tower.store.getCapacity() / 2) {
			let availableRamparts = [];
			for (const creep of hostileCreeps) {
				if (!creep.isDangerous()) continue;
				if (hivemind.relations.isAlly(creep.owner.username)) continue;

				if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
					availableRamparts = availableRamparts.concat(creep.pos.findInRange(FIND_MY_STRUCTURES, 3, {
						filter: s => s.structureType === STRUCTURE_RAMPART,
					}));
				}
				else {
					availableRamparts = availableRamparts.concat(creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
						filter: s => s.structureType === STRUCTURE_RAMPART,
					}));
				}
			}

			tower.repair(_.min(availableRamparts, 'hits'));
		}
	}
};

/**
 * Activates a room's safe mode when under attack.
 */
RoomDefenseProcess.prototype.manageSafeMode = function () {
	if (this.room.controller.safeMode) return;
	if (this.room.controller.safeModeCooldown) return;
	if (this.room.controller.safeModeAvailable < 1) return;
	if (this.room.defense.getEnemyStrength() < 2) return;
	if (this.room.defense.isWallIntact()) return;

	if (this.room.controller.activateSafeMode() === OK) {
		Game.notify('🛡 Activated safe mode in room ' + this.room.name + '. ' + this.room.controller.safeModeAvailable + ' remaining.');
	}
};

export default RoomDefenseProcess;
