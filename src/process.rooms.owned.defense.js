'use strict';

/* global FIND_MY_STRUCTURES STRUCTURE_TOWER FIND_HOSTILE_CREEPS FIND_MY_CREEPS
HEAL */

const Process = require('./process');

const RoomDefenseProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

RoomDefenseProcess.prototype = Object.create(Process.prototype);

RoomDefenseProcess.prototype.run = function () {
	// Handle towers.
	const towers = this.room.find(FIND_MY_STRUCTURES, {
		filter: structure => (structure.structureType === STRUCTURE_TOWER) && structure.energy > 0,
	});

	if (towers.length === 0) return;

	const hostileCreeps = this.room.find(FIND_HOSTILE_CREEPS);
	for (const tower of towers) {
		// Attack enemies.
		if (hostileCreeps.length > 0) {
			const target = this.room.getTowerTarget(tower);
			if (target) {
				tower.attack(target);
				continue;
			}

			const closestHostileHealer = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
				filter: creep => {
					for (const i in creep.body) {
						if (creep.body[i].type === HEAL && creep.body[i].hits > 0) {
							return true;
						}
					}

					return false;
				},
			});
			const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
				filter: creep => creep.isDangerous(),
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

module.exports = RoomDefenseProcess;
