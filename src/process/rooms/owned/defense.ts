/* global FIND_MY_STRUCTURES STRUCTURE_TOWER FIND_HOSTILE_CREEPS FIND_MY_CREEPS
HEAL */

import hivemind from 'hivemind';
import Process from 'process/process';
import {simpleAllies} from 'utils/communication';
import {ENEMY_STRENGTH_NONE, ENEMY_STRENGTH_NORMAL} from 'room-defense';

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
		this.manageDefense();
		this.room.defense.openRampartsToFriendlies();
		this.room.defense.drawDebug();

		this.room.visual.text('Wall status:' + (this.room.defense.isWallIntact() ? 'intact' : 'broken'), 5, 4);
		this.room.visual.text('Enemy strength: ' + this.room.defense.getEnemyStrength(), 5, 5);
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
						// @todo Only attack if we can be sure it's not tower drain.
						if (!this.room.controller.safeMode) {
							tower.attack(target);
						}
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
				continue;
			}

			// Heal friendlies.
			// @todo Don't check this for every tower in the room.
			const damagedPCs = tower.pos.findClosestByRange(FIND_MY_POWER_CREEPS, {
				filter: creep => creep.hits < creep.hitsMax,
			});
			if (damagedPCs) {
				tower.heal(damagedPCs);
				continue;
			}

			// Repair ramparts during a strong attack.
			if (enemyStrength >= ENEMY_STRENGTH_NORMAL && tower.store.getUsedCapacity(RESOURCE_ENERGY) > tower.store.getCapacity(RESOURCE_ENERGY) / 2) {
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
		if (this.room.controller.safeModeAvailable === 0) return;
		if (this.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return;
		if (this.room.defense.getEnemyStrength() < ENEMY_STRENGTH_NORMAL && Game.myRooms.length > 1) return;
		if (this.room.defense.isWallIntact()) return;
		if (this.room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_SPAWN}).length === 0) return;

		this.room.visual.text('I might safemode soon!', 25, 25);
		if (!this.isEnemyCloseToImportantStructures()) return;

		const result = this.room.controller.activateSafeMode();
		if (result === OK) {
			Game.notify('🛡 Activated safe mode in room ' + this.room.name + '. ' + this.room.controller.safeModeAvailable + ' remaining.');
		}
		else if (result === ERR_BUSY) {
			this.abandonSafemodedRoomIfNecessary();
		}
	}

	isEnemyCloseToImportantStructures(): boolean {
		for (const structure of this.getImportantStructures()) {
			for (const userName in this.room.enemyCreeps) {
				if (hivemind.relations.isAlly(userName)) continue;

				for (const creep of this.room.enemyCreeps[userName]) {
					if (structure instanceof Structure && !creep.isDangerous()) continue;

					// Max range is 1 more than actual creep range to allow for room unclaim before safemode.
					const maxRange = creep.getActiveBodyparts(RANGED_ATTACK) > 0 ? 4 : 2;
					if (structure.pos.getRangeTo(creep.pos) <= maxRange) return true;
				}
			}
		}

		return false;
	}

	getImportantStructures() {
		const importantStructures: Array<Structure | ConstructionSite> = this.room.find(FIND_MY_STRUCTURES, {filter: structure => {
			return ([
				STRUCTURE_FACTORY,
				STRUCTURE_LAB,
				STRUCTURE_NUKER,
				STRUCTURE_POWER_SPAWN,
				STRUCTURE_SPAWN,
				STRUCTURE_STORAGE,
				STRUCTURE_TERMINAL,
			] as string[]).includes(structure.structureType);
		}});
		importantStructures.push(this.room.controller);
		for (const constructionSite of this.room.find(FIND_MY_CONSTRUCTION_SITES, {filter: site => {
			return ([
				STRUCTURE_FACTORY,
				STRUCTURE_LAB,
				STRUCTURE_NUKER,
				STRUCTURE_POWER_SPAWN,
				STRUCTURE_SPAWN,
				STRUCTURE_STORAGE,
				STRUCTURE_TERMINAL,
			] as string[]).includes(site.structureType);
		}})) {
			if (constructionSite.progress < 10_000) continue;

			importantStructures.push(constructionSite);
		}

		return importantStructures;
	}

	abandonSafemodedRoomIfNecessary() {
		if (this.room.controller.level < 6) return;

		const maxLevelToAbandon = this.room.controller.level <= 6 ? 5 : 6;
		for (const room of Game.myRooms) {
			if (!room.controller.safeMode) continue;
			if (room.controller.level > maxLevelToAbandon) continue;

			room.controller.unclaim();
			return;
		}
	}

	/**
	 * Requests defense from allies when under attack.
	 */
	manageDefense() {
		if (this.room.controller.safeMode) return;
		if (this.room.defense.getEnemyStrength() <= ENEMY_STRENGTH_NORMAL) return;

		const priority = 0.5 * this.room.controller.level / 8;
		if (!Memory.requests.defense) Memory.requests.defense = {};
		Memory.requests.defense[this.room.name] = {
			priority,
			lastSeen: Game.time,
		}
	}
}
