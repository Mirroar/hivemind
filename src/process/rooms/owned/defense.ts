/* global STRUCTURE_TOWER HEAL */

import hivemind from 'hivemind';
import Process from 'process/process';
import {ENEMY_STRENGTH_NONE, ENEMY_STRENGTH_NORMAL, EnemyStrength} from 'room-defense';
import cache from 'utils/cache';

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
		this.manageDefenseRequests();
		this.room.defense.openRampartsToFriendlies();
		this.room.defense.drawDebug();

		this.room.visual.text('Wall status:' + (this.room.defense.isWallIntact() ? 'intact' : 'broken'), 5, 4);
		this.room.visual.text('Enemy strength: ' + this.room.defense.getEnemyStrength(), 5, 5);
	}

	/**
	 * Manages this room's towers.
	 */
	manageTowers() {
		const towers = _.filter(this.room.myStructuresByType[STRUCTURE_TOWER], s => s.energy > 0 && s.isOperational());

		if (towers.length === 0) return;

		const hostileCreeps = this.getHostileCreeps();
		const enemyStrength = this.room.defense.getEnemyStrength();
		for (const tower of towers) {
			if (this.performTowerAttack(tower, hostileCreeps)) continue;
			if (this.performTowerHeal(tower, enemyStrength)) continue;
			if (this.performTowerRampartRepair(tower, hostileCreeps, enemyStrength)) continue;
		}
	}

	getHostileCreeps(): Creep[] {
		let hostileCreeps: Creep[] = [];
		for (const userName in this.room.enemyCreeps) {
			if (hivemind.relations.isAlly(userName)) continue;

			hostileCreeps = hostileCreeps.concat(this.room.enemyCreeps[userName]);
		}

		return hostileCreeps;
	}

	performTowerAttack(tower: StructureTower, hostileCreeps: Creep[]): boolean {
		if (hostileCreeps.length === 0) return false;

		// Use new military manager if possible.
		const target = this.room.getTowerTarget();
		if (!target) return false;
	
		this.room.visual.line(tower.pos.x, tower.pos.y, target.pos.x, target.pos.y, {color: 'red'});

		// @todo Only attack if we can be sure it's not tower drain.
		// @todo We might want to attack targets close to the room edge if they're close to ramparts, as well.
		if (
			(this.room.controller.safeMode ?? 1000) < 200
			|| target.pos.getRangeTo(25, 25) <= 20
			|| target.owner.username === 'Invader'
			|| target.hits < target.hitsMax
			|| this.canKillBeforeFleeing(target)
		) {
			if (tower.attack(target) === OK) return true;
		}

		return false;
	}

	canKillBeforeFleeing(target: Creep): boolean {
		const potentialDamage = this.room.getMilitaryAssertion(target.pos.x, target.pos.y, 'myDamage');
		const potentialHealing = this.room.getMilitaryAssertion(target.pos.x, target.pos.y, 'healing');
		// Potential damage is reduced if creep has boosted tough parts.
		const effectiveDamage = target.getEffectiveDamage(potentialDamage);

		const distanceToExit = 24 - target.pos.getRangeTo(25, 25);
		if (distanceToExit <= 0) return false;

		return effectiveDamage * distanceToExit > target.hits;
	}

	performTowerHeal(tower: StructureTower, enemyStrength: EnemyStrength): boolean {
		const damagedTargets = cache.inObject(tower.room, 'damagedTargetsToHeal', 1, () => {
			const damagedCreeps = _.filter(tower.room.creeps, creep => creep.hits < creep.hitsMax && (
				creep.getActiveBodyparts(ATTACK) > 0
				|| creep.getActiveBodyparts(RANGED_ATTACK) > 0
				|| enemyStrength === 0
			));
			const damagedPCs = _.filter(tower.room.powerCreeps, creep => creep.hits < creep.hitsMax);

			return [...damagedCreeps, ...damagedPCs];
		});
		if (damagedTargets.length === 0) return false;

		const bestTarget = _.min(damagedTargets, creep => creep.hits / creep.hitsMax / (1 + tower.getPowerAtRange(tower.pos.getRangeTo(creep.pos))));
		if (!bestTarget) return false;
		if (tower.heal(bestTarget) === OK) return true;

		return false;
	}

	performTowerRampartRepair(tower: StructureTower, hostileCreeps: Creep[], enemyStrength: EnemyStrength): boolean {
		// Repair ramparts during a strong attack.
		if (enemyStrength < ENEMY_STRENGTH_NORMAL) return false;
		if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < tower.store.getCapacity(RESOURCE_ENERGY) / 2) return false;
	
		const availableRamparts = cache.inObject(tower.room, 'endangeredRamparts', 1, () => {
			let availableRamparts = new Set<StructureRampart>();
			for (const creep of hostileCreeps) {
				if (!creep.isDangerous()) continue;

				const creepRange = creep.getActiveBodyparts(RANGED_ATTACK) > 0 ? 3 : 1;
				const rampartsInRange = (tower.room.structuresByType[STRUCTURE_RAMPART] || []).filter(rampart => rampart.pos.getRangeTo(creep.pos) <= creepRange);

				for (const rampart of rampartsInRange) {
					availableRamparts.add(rampart);
				}
			}

			return availableRamparts;
		});
		if (availableRamparts.size === 0) return false;

		const prioritizedRampart = _.min([...availableRamparts], rampart => rampart.hits / (1 + tower.getPowerAtRange(tower.pos.getRangeTo(rampart.pos))));
		if (!prioritizedRampart) return false;

		if (tower.repair(prioritizedRampart) === OK) return true;

		return false;
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
		if ((this.room.myStructuresByType[STRUCTURE_SPAWN] || []).length === 0) return;

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
					// Structures can only be attacked by dangerous creeps, but
					// construction sites can be stomped by any creep.
					if (structure instanceof Structure && !creep.isDangerous()) continue;

					// Max range is 1 more than actual creep range to allow for
					// room unclaim before safemode.
					const maxRange = creep.getActiveBodyparts(RANGED_ATTACK) > 0 ? 4 : 2;
					if (structure.pos.getRangeTo(creep.pos) <= maxRange) return true;
				}
			}
		}

		return false;
	}

	getImportantStructures() {
		const importantStructures: Array<Structure | ConstructionSite> = _.filter(this.room.myStructures, structure => ([
			STRUCTURE_FACTORY,
			STRUCTURE_LAB,
			STRUCTURE_NUKER,
			STRUCTURE_POWER_SPAWN,
			STRUCTURE_SPAWN,
			STRUCTURE_STORAGE,
			STRUCTURE_TERMINAL,
		] as string[]).includes(structure.structureType));
		importantStructures.push(this.room.controller);
		for (const constructionSite of this.room.find(FIND_MY_CONSTRUCTION_SITES, {filter: site => ([
			STRUCTURE_FACTORY,
			STRUCTURE_LAB,
			STRUCTURE_NUKER,
			STRUCTURE_POWER_SPAWN,
			STRUCTURE_SPAWN,
			STRUCTURE_STORAGE,
			STRUCTURE_TERMINAL,
		] as string[]).includes(site.structureType)})) {
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
			Game.notify('🛡 Unclaimed ' + room.name + ' to free up safe mode for room ' + this.room.name + '.');
			return;
		}
	}

	/**
	 * Requests defense from allies when under attack.
	 */
	manageDefenseRequests() {
		if (this.room.controller.safeMode) return;
		if (this.room.defense.getEnemyStrength() <= ENEMY_STRENGTH_NORMAL) return;

		const priority = 0.5 * this.room.controller.level / 8;
		if (!Memory.requests.defense) Memory.requests.defense = {};
		Memory.requests.defense[this.room.name] = {
			priority,
			lastSeen: Game.time,
		};
	}
}
