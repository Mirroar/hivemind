/* global FIND_MY_STRUCTURES STRUCTURE_TOWER FIND_HOSTILE_CREEPS FIND_MY_CREEPS
HEAL */


import Process from 'process/process';

export default class RoomDefenseProcess extends Process {
	room: Room;

	/**
	 * Manage defenses in a room.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters) {
		super(parameters);
		this.room = parameters.room;
	}

	/**
	 * Manages defenses.
	 */
	run() {
		this.manageTowers();
		this.manageSafeMode();
		this.room.defense.openRampartsToFriendlies();
	}

	/**
	 * Manages this room's towers.
	 */
	manageTowers() {
		const towers = this.room.find<StructureTower>(FIND_MY_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_TOWER) && structure.energy > 0,
		});

		if (towers.length === 0) return;

		const hostileCreeps = this.room.find(FIND_HOSTILE_CREEPS);
		const enemyStrength = this.room.defense.getEnemyStrength();
		for (const tower of towers) {
			// Attack enemies.
			if (hostileCreeps.length > 0) {
				// Use new military manager if possible.
				const target = this.room.getTowerTarget();
				if (target) {
					this.room.visual.line(tower.pos.x, tower.pos.y, target.pos.x, target.pos.y, {color: 'red'});

					if (target.my) {
						tower.heal(target);
					}
					else {
						tower.attack(target);
					}

					continue;
				}
			}

			// Heal friendlies.
			// @todo Don't check this for every tower in the room.
			const damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
				filter: creep => creep.hits < creep.hitsMax && (creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0 || enemyStrength === 0),
			});
			if (damaged) {
				tower.heal(damaged);
			}

			// Repair ramparts during a strong attack.
			if (enemyStrength > 1 && tower.store.getUsedCapacity(RESOURCE_ENERGY) > tower.store.getCapacity(RESOURCE_ENERGY) / 2) {
				let availableRamparts = [];
				for (const creep of hostileCreeps) {
					if (!creep.isDangerous()) continue;
					if (hivemind.relations.isAlly(creep.owner.username)) continue;

					if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
						availableRamparts = availableRamparts.concat(creep.pos.findInRange(FIND_MY_STRUCTURES, 3, {
							filter: s => s.structureType === STRUCTURE_RAMPART && this.room.roomPlanner.isPlannedLocation(s.pos, 'rampart'),
						}));
					}
					else {
						availableRamparts = availableRamparts.concat(creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
							filter: s => s.structureType === STRUCTURE_RAMPART && this.room.roomPlanner.isPlannedLocation(s.pos, 'rampart'),
						}));
					}
				}

				tower.repair(_.min(availableRamparts, 'hits'));
			}
		}
	}

	/**
	 * Activates a room's safe mode when under attack.
	 */
	manageSafeMode() {
		if (this.room.controller.safeMode) return;
		if (this.room.controller.safeModeCooldown) return;
		if (this.room.controller.safeModeAvailable < 1) return;
		if (this.room.defense.getEnemyStrength() < 2) return;
		if (this.room.defense.isWallIntact()) return;

		if (this.room.controller.activateSafeMode() === OK) {
			Game.notify('🛡 Activated safe mode in room ' + this.room.name + '. ' + this.room.controller.safeModeAvailable + ' remaining.');
		}
	}
}
