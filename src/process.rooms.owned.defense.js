'use strict';

/* global FIND_MY_STRUCTURES STRUCTURE_TOWER FIND_HOSTILE_CREEPS FIND_MY_CREEPS
HEAL */

const Process = require('./process');

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
	this.room.defense.openRampartsToFriendlies();
	this.manageTowers();
	this.manageSafeMode();
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
			// @todo Use new military manager when performance is stable.
			// const target = this.room.getTowerTarget(tower);
			// if (target) {
			// 	tower.attack(target);
			// 	continue;
			// }

			const closestHostileHealer = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
				filter: creep => {
					for (const i in creep.body) {
						if (creep.body[i].type === HEAL && creep.body[i].hits > 0) {
							return creep.isDangerous();
						}
					}

					return false;
				},
			});
			const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
				filter: creep => creep.isDangerous() || this.room.defense.isThief(creep),
			});

			if (closestHostileHealer) {
				tower.attack(closestHostileHealer);
				continue;
			}

			if (closestHostile) {
				tower.attack(closestHostile);
				continue;
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

	Game.notify('🛡 Activated safe mode in room ' + this.room.name + '. ' + this.room.controller.safeModeAvailable + ' remaining.');
	this.room.controller.activateSafeMode();
};

module.exports = RoomDefenseProcess;
