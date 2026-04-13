/* global PathFinder RoomPosition StructureController ATTACK SYSTEM_USERNAME
STRUCTURE_CONTROLLER STRUCTURE_STORAGE STRUCTURE_SPAWN STRUCTURE_TOWER HEAL
LOOK_STRUCTURES FIND_STRUCTURES FIND_MY_CREEPS CLAIM
FIND_HOSTILE_STRUCTURES FIND_HOSTILE_CREEPS RANGED_ATTACK
STRUCTURE_INVADER_CORE STRUCTURE_PORTAL TERRAIN_MASK_WALL */

import container from 'utils/container';
import hivemind from 'hivemind';
import Role from 'role/role';
import utilities from 'utilities';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getCostMatrix} from 'utils/cost-matrix';

interface ControllerTargetOption extends WeightedOption {
	type: 'controller';
	object: StructureController;
}

interface CreepTargetOption extends WeightedOption {
	type: 'creep';
	object: Creep;
}

interface HostileCreepTargetOption extends WeightedOption {
	type: 'hostilecreep';
	object: Creep;
}

interface HostileStructureTargetOption extends WeightedOption {
	type: 'hostilestructure';
	object: AnyStructure;
}

export type MilitaryTargetOption = ControllerTargetOption | CreepTargetOption | HostileCreepTargetOption | HostileStructureTargetOption;

declare global {
	interface MilitaryCreep extends Creep {
		memory: MilitaryCreepMemory;
		heapMemory: MilitaryCreepHeapMemory;
	}

	interface MilitaryCreepMemory extends CreepMemory {
		initialized?: boolean;
		order?: {
			type: 'attack' | 'heal' | 'claim';
			target: Id<Creep | AnyStructure>;
		};
		target?: string;
	}

	interface MilitaryCreepHeapMemory extends CreepHeapMemory {
	}
}

/**
 * Base class for military combat creep roles.
 *
 * Provides shared targeting, movement, and attack logic used by both
 * individual defenders and squad-based combat creeps.
 */
export default class MilitaryRole extends Role {
	constructor() {
		super();

		// Military creeps are always fully active!
		this.stopAt = 0;
		this.throttleAt = 0;
	}

	/**
	 * Sets a good military target for this creep.
	 *
	 * Sets memory.order as the movement intent and controller claim/reserve target.
	 * Per-tick reactive attacks (attack/rangedAttack/heal) are handled separately by
	 * CombatManager.manageCombatActions(), which is called after movement is resolved.
	 */
	calculateMilitaryTarget(creep: MilitaryCreep) {
		const options = this.getAvailableMilitaryTargets(creep);
		const best = utilities.getBestOption(options);

		if (!best) {
			delete creep.memory.order;
			this.onNoTargets(creep, options);
			return;
		}

		let action: 'attack' | 'heal' | 'claim' = 'heal';
		if (best.type === 'hostilecreep' || best.type === 'hostilestructure') {
			action = 'attack';
		}
		else if (best.type === 'controller') {
			action = 'claim';
		}

		creep.memory.order = {
			type: action,
			target: best.object.id,
		};
	}

	/**
	 * Hook called when no military targets are available.
	 * Subclasses may override to implement recycle or other fallback behavior.
	 */
	onNoTargets(_creep: MilitaryCreep, _options: MilitaryTargetOption[]) {
		// Default: no-op.
	}

	/**
	 * Get a priority list of military targets for this creep.
	 *
	 * @param {MilitaryCreep} creep
	 *   The creep to run logic for.
	 *
	 * @return {MilitaryTargetOption[]}
	 *   An array of target options for this creep.
	 */
	getAvailableMilitaryTargets(creep: MilitaryCreep): MilitaryTargetOption[] {
		const options: MilitaryTargetOption[] = [];

		if (!creep.memory.target) return options;

		const targetPosition = decodePosition(creep.memory.target);
		if (!targetPosition) {
			delete creep.memory.target;
			return options;
		}

		// @todo Defend ourselves even when not in target room.
		if (creep.pos.roomName !== targetPosition.roomName) return options;

		// Find enemies to attack.
		if (creep.getActiveBodyparts(ATTACK) || creep.getActiveBodyparts(RANGED_ATTACK)) {
			this.addMilitaryAttackOptions(creep, options, targetPosition);
		}

		// Find friendlies to heal.
		if (creep.getActiveBodyparts(HEAL)) {
			this.addMilitaryHealOptions(creep, options);
		}

		// Attack / Reserve controllers.
		if (creep.getActiveBodyparts(CLAIM) > 0 && creep.room.controller && !creep.room.controller.my && creep.room.controller.owner) {
			options.push({
				priority: 5,
				weight: 0,
				type: 'controller',
				object: creep.room.controller,
			});
		}

		if (creep.getActiveBodyparts(CLAIM) > 0 && creep.room.controller && !creep.room.controller.owner) {
			options.push({
				priority: 4,
				weight: 0,
				type: 'controller',
				object: creep.room.controller,
			});
		}

		return options;
	}

	/**
	 * Adds attack options to military targets for this creep.
	 *
	 * @param {MilitaryCreep} creep
	 *   The creep to run logic for.
	 * @param {MilitaryTargetOption[]} options
	 *   An array of target options for this creep.
	 * @param {RoomPosition} targetPosition
	 *   The creep's primary target position.
	 */
	addMilitaryAttackOptions(creep: MilitaryCreep, options: MilitaryTargetOption[], targetPosition: RoomPosition) {
		const enemies = creep.room.find(FIND_HOSTILE_CREEPS);

		if (enemies.length > 0) {
			for (const enemy of enemies) {
				if (hivemind.relations.isAlly(enemy.owner.username)) continue;

				// Don't deliberately engage source keepers.
				if (enemy.owner.username === 'Source Keeper') continue;

				const option: HostileCreepTargetOption = {
					priority: 4,
					weight: 1 - (creep.pos.getRangeTo(enemy) / 50),
					type: 'hostilecreep',
					object: enemy,
				};

				// Check if enemy is harmless, and adjust priority.
				if (!enemy.isDangerous()) {
					option.priority = 1;
				}

				// @todo Calculate weight / priority from distance, HP left, parts.

				options.push(option);
			}
		}

		// Find structures to attack.
		let structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
			filter: structure => structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_STORAGE && structure.hits,
		});
		if (!creep.room.controller?.owner || hivemind.relations.isAlly(creep.room.controller.owner.username)) {
			// Outside of owned rooms, only attack invader cores.
			structures = creep.room.structuresByType[STRUCTURE_INVADER_CORE] || [];
		}

		// Attack structures under target flag (even if non-hostile, like walls).
		const directStructures = targetPosition.lookFor(LOOK_STRUCTURES);
		for (const structure of (directStructures as AnyOwnedStructure[]) || []) {
			if (structure.structureType !== STRUCTURE_CONTROLLER && structure.hits) {
				structures.push(structure);
			}
		}

		for (const structure of structures) {
			const option: HostileStructureTargetOption = {
				priority: encodePosition(structure.pos) === creep.memory.target ? 5 : 2,
				weight: 0,
				type: 'hostilestructure',
				object: structure,
			};

			// @todo Calculate weight / priority from distance, HP left, parts.
			if (structure.structureType === STRUCTURE_SPAWN) {
				option.priority = 4;
			}

			if (structure.structureType === STRUCTURE_TOWER) {
				option.priority = 3;
			}

			options.push(option);
		}

		// Find walls in front of controller.
		if (creep.room.controller && creep.room.controller.owner && !creep.room.controller.my) {
			const structures = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: structure => structure.structureType !== STRUCTURE_CONTROLLER,
			});

			for (const structure of structures) {
				const option: HostileStructureTargetOption = {
					priority: 0,
					weight: 0,
					type: 'hostilestructure',
					object: structure,
				};

				options.push(option);
			}
		}
	}

	/**
	 * Adds heal options to military targets for this creep.
	 *
	 * @param {MilitaryCreep} creep
	 *   The creep to run logic for.
	 * @param {MilitaryTargetOption[]} options
	 *   An array of target options for this creep.
	 */
	addMilitaryHealOptions(creep: MilitaryCreep, options: MilitaryTargetOption[]) {
		let damaged = creep.room.find(FIND_MY_CREEPS, {
			filter: friendly => ((friendly.id !== creep.id) && (friendly.hits < friendly.hitsMax)),
		});
		if (_.size(damaged) === 0) {
			damaged = creep.room.find(FIND_HOSTILE_CREEPS, {
				filter: friendly => ((friendly.id !== creep.id) && (friendly.hits < friendly.hitsMax) && hivemind.relations.isAlly(friendly.owner.username)),
			});
		}

		for (const friendly of damaged) {
			const option: CreepTargetOption = {
				priority: 3,
				weight: 0,
				type: 'creep',
				object: friendly,
			};

			// @todo Calculate weight / priority from distance, HP left, parts.

			options.push(option);
		}
	}

	/**
	 * Handles inter-room travel toward the creep's target. Interrupts movement
	 * when player-controlled enemies are detected so the combat manager can kite.
	 * Invaders and Source Keepers are intentionally ignored to allow passing through
	 * SK rooms and rooms with standard NPC invaders.
	 *
	 * @param {MilitaryCreep} creep
	 * @param {RoomPosition} targetPosition
	 * @param {boolean} allowDanger Whether to travel through unsafe rooms.
	 * @return {boolean} True if movement was handled and no further action is needed.
	 */
	performInterRoomTravel(creep: MilitaryCreep, targetPosition: RoomPosition, allowDanger: boolean): boolean {
		let enemiesNearby = false;
		if (creep.getActiveBodyparts(ATTACK) || creep.getActiveBodyparts(RANGED_ATTACK) || creep.getActiveBodyparts(HEAL)) {
			_.each(creep.room.enemyCreeps, (hostiles, owner) => {
				if (hivemind.relations.isAlly(owner)) return null;

				_.each(hostiles, c => {
					if (!c.isDangerous()) return null;
					if (c.owner.username === SYSTEM_USERNAME || c.owner.username === 'Invader' || c.owner.username === 'Source Keeper') return null;

					enemiesNearby = true;
					return false;
				});

				if (enemiesNearby) return false;

				return null;
			});
		}

		if (!enemiesNearby && creep.interRoomTravel(targetPosition, allowDanger)) return true;

		if (enemiesNearby) {
			// @todo We want to ideally move to `targetPosition`, so use that as target if possible.
			container.get('CombatManager').performKitingMovement(creep, container.get('CombatManager').getMostValuableTarget(creep));
			return true;
		}

		return false;
	}

	/**
	 * Handles in-room behaviour: engaging ordered targets or falling
	 * back to room defense and idle movement.
	 *
	 * @param {MilitaryCreep} creep
	 */
	performInRoomBehavior(creep: MilitaryCreep) {
		if (creep.memory.order) {
			const target = Game.getObjectById(creep.memory.order.target);
			this.moveToEngageTarget(creep, target);
			return;
		}

		this.performIdleMovement(creep);
	}

	/**
	 * Default idle behavior: chase nearby enemies, then drift toward room center.
	 *
	 * @param {MilitaryCreep} creep
	 */
	performIdleMovement(creep: MilitaryCreep) {
		// Simple room defenders: look for enemies and engage.
		for (const username in creep.room.enemyCreeps || {}) {
			if (username === 'Source Keeper') continue;
			if (hivemind.relations.isAlly(username)) continue;

			const hostiles = creep.room.enemyCreeps[username];
			creep.whenInRange(1, hostiles[0], () => {}, {allowDanger: true});
			return;
		}

		creep.whenInRange(10, new RoomPosition(25, 25, creep.pos.roomName), () => {});
	}

	/**
	 * Checks if a position is blocked by terrain or impassable structures.
	 */
	isPositionBlocked(position: RoomPosition): boolean {
		const room = Game.rooms[position.roomName];
		if (!room) return false;

		const terrain = new Room.Terrain(room.name);
		if (terrain && terrain.get(position.x, position.y) === TERRAIN_MASK_WALL) return true;

		const structures = position.lookFor(LOOK_STRUCTURES);
		for (const structure of structures) {
			if (!structure.isWalkable()) return true;
			if (structure.structureType === STRUCTURE_PORTAL) return true;
		}

		return false;
	}

	/**
	 * Moves a creep toward its engagement target, choosing behavior
	 * based on available body parts (melee, ranged, or passive).
	 *
	 * @param {MilitaryCreep} creep
	 * @param {RoomObject | null} target
	 */
	moveToEngageTarget(creep: MilitaryCreep, target: RoomObject | null) {
		if (!target) {
			// @todo Still try to avoid other hostiles.
			creep.whenInRange(10, new RoomPosition(25, 25, creep.pos.roomName), () => {});

			return;
		}

		if (creep.getActiveBodyparts(ATTACK)) {
			// @todo Use custom cost matrix to determine which structures we may move through on our way to the target.
			creep.moveTo(target, {
				reusePath: 0,
				ignoreDestructibleStructures: false,
				maxRooms: 1,
			});

			return;
		}

		if (creep.getActiveBodyparts(RANGED_ATTACK)) {
			// @todo Use custom cost matrix to determine which structures we may move through on our way to the target.
			if (creep.pos.getRangeTo(target.pos) >= 3) {
				creep.moveTo(target, {
					reusePath: 0,
					ignoreDestructibleStructures: false,
					maxRooms: 1,
					range: 2,
				});

				return;
			}

			// @todo Only flee from melee creeps.
			// @todo Adjust cost matrix to disincentivize tiles around hostiles.
			// @todo Include friendly creeps in obstacle list to prevent blocking.
			const result = PathFinder.search(creep.pos, {pos: target.pos, range: 2}, {
				roomCallback: roomName => getCostMatrix(roomName, {ignoreMilitary: true}),
				flee: true,
				maxRooms: 1,
			});

			if (result.path && result.path.length > 0) {
				creep.move(creep.pos.getDirectionTo(result.path[0]));
			}

			return;
		}

		// Non-combat creeps just move toward their target.
		creep.whenInRange(1, target, () => {});
	}

	/**
	 * Makes a creep try to interact with an enemy controller.
	 * Override in subclasses for squad-specific claiming behavior.
	 *
	 * @param {MilitaryCreep} creep
	 *   The creep to run logic for.
	 * @param {StructureController} controller
	 *   The controller to interact with.
	 *
	 * @return {boolean}
	 *   True if an action was performed.
	 */
	handleControllerAction(creep: MilitaryCreep, controller: StructureController): boolean {
		if (controller.owner && creep.attackController(controller) === OK) {
			return true;
		}

		if (creep.reserveController(controller) === OK) {
			return true;
		}

		return false;
	}
}
