/* global PathFinder RoomPosition StructureController ATTACK SYSTEM_USERNAME
STRUCTURE_CONTROLLER STRUCTURE_STORAGE STRUCTURE_SPAWN STRUCTURE_TOWER HEAL
LOOK_STRUCTURES FIND_STRUCTURES FIND_MY_CREEPS CREEP_LIFE_TIME CLAIM
FIND_HOSTILE_STRUCTURES OK STRUCTURE_TERMINAL STRUCTURE_INVADER_CORE
ERR_BUSY ERR_NOT_OWNER ERR_TIRED RANGED_ATTACK FIND_HOSTILE_CREEPS */

import container from 'utils/container';
import hivemind from 'hivemind';
import PathManager from 'empire/remote-path-manager';
import Role from 'role/role';
import SquadCivilianEscort from 'role/squad-civilian-escort';
import TransporterRole from 'role/transporter';
import utilities from 'utilities';
import {encodePosition, decodePosition, serializePositionPath} from 'utils/serialization';
import {getCostMatrix} from 'utils/cost-matrix';
import {getUsername} from 'utils/account';
import SquadManager from 'manager.squad';

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

type MilitaryTargetOption = ControllerTargetOption | CreepTargetOption | HostileCreepTargetOption | HostileStructureTargetOption;

declare global {
	interface BrawlerCreep extends Creep {
		memory: BrawlerCreepMemory;
		heapMemory: BrawlerCreepHeapMemory;
	}

	interface BrawlerCreepMemory extends CreepMemory {
		role: 'brawler';
		initialized?: boolean;
		squadName: string;
		squadUnitType: SquadUnitType;
		fillWithEnergy?: boolean;
		pathTarget?: string;
		order: {
			type: 'attack' | 'heal' | 'claim';
			target: Id<Creep | AnyStructure>;
		};
		target: string;
	}

	interface BrawlerCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class BrawlerRole extends Role {
	transporterRole: TransporterRole;
	squadManager: SquadManager;
	squadCivilianEscort: SquadCivilianEscort;

	constructor() {
		super();

		// Military creeps are always fully active!
		this.stopAt = 0;
		this.throttleAt = 0;

		this.transporterRole = new TransporterRole();
		this.squadManager = container.get('SquadManager');
		this.squadCivilianEscort = new SquadCivilianEscort();
	}

	/**
	 * Makes a creep behave like a brawler.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: BrawlerCreep) {
		if (!creep.memory.initialized) {
			this.initBrawlerState(creep);
		}

		// Target is recalculated every tick for best results.
		this.calculateMilitaryTarget(creep);

		this.performMilitaryMove(creep);

		if (creep.memory.order) {
			// Attack ordered target first.
			const target = Game.getObjectById<Creep | AnyStructure>(creep.memory.order.target);

			if (target instanceof StructureController && !target.my && this.attackMilitaryTarget(creep, target)) return;
		}

		container.get('CombatManager').manageCombatActions(creep);
	}

	/**
	 * Initializes memory of military creeps.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	initBrawlerState(creep: BrawlerCreep) {
		creep.memory.initialized = true;

		if (creep.memory.squadUnitType === 'builder' && !creep.memory.squadCivilianSpecialization) {
			creep.memory.fillWithEnergy = true;
		}

		if (creep.memory.pathTarget) {
			// Reuse remote harvesting path.
			const pathManager = new PathManager();
			const path = pathManager.getPathFor(decodePosition(creep.memory.pathTarget));
			if (path) {
				creep.setCachedPath(serializePositionPath(path), true);
			}
		}
	}

	/**
	 * Sets a good military target for this creep.
	 *
	 * Sets memory.order as the movement intent and controller claim/reserve target.
	 * Per-tick reactive attacks (attack/rangedAttack/heal) are handled separately by
	 * CombatManager.manageCombatActions(), which is called after movement is resolved.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	calculateMilitaryTarget(creep: BrawlerCreep) {
		const options = this.getAvailableMilitaryTargets(creep);
		const best = utilities.getBestOption(options);

		if (!best) {
			delete creep.memory.order;
			// @todo Run home for healing if no functional parts are left.
			if (options.length === 0 && creep.getActiveBodyparts(CLAIM) > 0 && creep.memory.squadName?.startsWith('expand')) {
				this.performRecycle(creep);
			}

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
	 * Get a priority list of military targets for this creep.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {Array}
	 *   An array of target options for this creep.
	 */
	getAvailableMilitaryTargets(creep: BrawlerCreep) {
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
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Array} options
	 *   An array of target options for this creep.
	 */
	addMilitaryAttackOptions(creep: BrawlerCreep, options: MilitaryTargetOption[], targetPosition: RoomPosition) {
		const enemies = creep.room.find(FIND_HOSTILE_CREEPS);

		if (enemies.length > 0) {
			for (const enemy of enemies) {
				if (hivemind.relations.isAlly(enemy.owner.username)) continue;

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
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Array} options
	 *   An array of target options for this creep.
	 */
	addMilitaryHealOptions(creep: BrawlerCreep, options: MilitaryTargetOption[]) {
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
	 * Makes a creep move towards its designated target.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performMilitaryMove(creep: BrawlerCreep) {
		if (creep.isPartOfTrain() && this.performTrainMove(creep) !== OK) return;

		if (this.performEnergyFilling(creep)) return;

		let allowDanger = true;
		if (creep.memory.squadName) {
			this.performSquadMove(creep);

			// Don't move expansion squads through enemy rooms.
			if (creep.memory.squadName.startsWith('expand')) allowDanger = false;
		}

		if (creep.memory.target) {
			const targetPosition = decodePosition(creep.memory.target);
			if (targetPosition && creep.pos.roomName === targetPosition.roomName) {
				this.squadCivilianEscort.attemptCivilianConversion(creep);
			}

			if (this.performInterRoomTravel(creep, targetPosition, allowDanger)) return;
		}

		this.performInRoomBehavior(creep);
	}

	/**
	 * Handles energy filling for squad builder units before they depart.
	 *
	 * @param {BrawlerCreep} creep
	 * @return {boolean} True if the creep is busy filling energy and should stop.
	 */
	performEnergyFilling(creep: BrawlerCreep): boolean {
		if (!creep.memory.fillWithEnergy) return false;

		if (creep.room.isMine() && creep.store.getFreeCapacity() > 0) {
			if (creep.room.getEffectiveAvailableEnergy() < 3000) {
				creep.whenInRange(5, new RoomPosition(25, 25, creep.room.name), () => {});
				return true;
			}

			this.transporterRole.performGetEnergy(creep as unknown as TransporterCreep);
			return true;
		}

		delete creep.memory.fillWithEnergy;
		return false;
	}

	/**
	 * Handles inter-room travel toward the creep's target. Interrupts movement
	 * when player-controlled enemies are detected so the combat manager can kite.
	 * Invaders and Source Keepers are intentionally ignored to allow passing through
	 * SK rooms and rooms with standard NPC invaders.
	 *
	 * @param {BrawlerCreep} creep
	 * @param {RoomPosition} targetPosition
	 * @param {boolean} allowDanger Whether to travel through unsafe rooms.
	 * @return {boolean} True if movement was handled and no further action is needed.
	 */
	performInterRoomTravel(creep: BrawlerCreep, targetPosition: RoomPosition, allowDanger: boolean): boolean {
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
	 * Handles in-room behaviour: engaging ordered targets, following squad
	 * positioning instructions, and falling back to room defence or idle movement.
	 *
	 * @param {BrawlerCreep} creep
	 */
	performInRoomBehavior(creep: BrawlerCreep) {
		if (creep.memory.order) {
			const target = Game.getObjectById(creep.memory.order.target);
			this.moveToEngageTarget(creep, target);

			return;
		}

		if (creep.memory.squadName) {
			// This only gets called for squad units in a room where no fighting
			// needs to take place.
			const squad = this.squadManager.getSquad(creep.memory.squadName);
			const targetPos = squad && squad.getTarget();
			if (targetPos) {
				creep.whenInRange(this.isPositionBlocked(targetPos) ? 3 : 0, targetPos, () => {
					const structures = targetPos.lookFor(LOOK_STRUCTURES);
					if (_.some(structures, s => s.structureType === STRUCTURE_PORTAL)) {
						creep.move(creep.pos.getDirectionTo(targetPos));
					}
				});

				return;
			}
		}

		// Simple room defenders: look for enemies and engage.
		for (const username in creep.room.enemyCreeps || {}) {
			if (hivemind.relations.isAlly(username)) continue;

			const hostiles = creep.room.enemyCreeps[username];
			creep.whenInRange(1, hostiles[0], () => {}, {allowDanger: true});
		}

		creep.whenInRange(10, new RoomPosition(25, 25, creep.pos.roomName), () => {});
	}

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

	moveToEngageTarget(creep: BrawlerCreep, target: RoomObject | null) {
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

	performTrainMove(creep: BrawlerCreep) {
		// @todo Implement joined room border traversal.

		if (!creep.isTrainFullySpawned()) {
			// @todo Refresh creep if spawning takes a long time.

			// Stay inside of spawn room.
			const roomCenter = new RoomPosition(25, 25, creep.pos.roomName);
			if (creep.pos.getRangeTo(roomCenter) > 20) {
				creep.whenInRange(20, roomCenter, () => {});
				return ERR_BUSY;
			}

			// Move randomly around the room to not block spawns or other creeps.
			const direction = (1 + Math.floor(Math.random() * 8)) as DirectionConstant;
			creep.move(direction);
			return ERR_BUSY;
		}

		// Only the train head will schedule movement intents. The other creeps will
		// move when the head moves. ERR_NOT_OWNER is used non-semantically here —
		// it signals to performMilitaryMove() that this creep should not act further.
		if (!creep.isTrainHead()) return ERR_NOT_OWNER;

		// Make sure train is joined.
		if (!creep.isTrainJoined()) {
			creep.joinTrain();
			return ERR_BUSY;
		}

		// If any segment is fatigued, we can't move, or only move adjacent to
		// next segment.
		const segments = creep.getTrainParts();
		for (const segment of segments) {
			if (segment.fatigue > 0) return ERR_TIRED;
		}

		// Head may move. Make sure all other parts follow.
		for (let i = 1; i < segments.length; i++) {
			if (segments[i].pos.roomName !== segments[i - 1].pos.roomName) {
				segments[i].moveToRange(segments[i - 1].pos, 1);
				continue;
			}

			segments[i].move(segments[i].pos.getDirectionTo(segments[i - 1].pos));
		}

		return OK;
	}

	/**
	 * Makes a creep move as part of a squad.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performSquadMove(creep: BrawlerCreep) {
		// Check if there are orders and set a target accordingly.
		const squad = this.squadManager.getSquad(creep.memory.squadName);
		if (!squad) return; // @todo Go recycle.

		// Movement is dictated by squad orders.
		const orders = squad.getOrders();
		if (orders.length > 0) {
			creep.memory.target = orders[0].target;
		}
		else {
			delete creep.memory.target;
		}

		if (creep.memory.target) return;

		// If no order has been given, wait by spawn and renew.
		const spawnRoom = squad.getSpawn();
		if (!spawnRoom || creep.pos.roomName !== spawnRoom) return;

		// Refresh creep if it's getting low, so that it has high lifetime when a mission finally starts.
		if (creep.ticksToLive < CREEP_LIFE_TIME * 0.66) {
			const spawn = creep.pos.findClosestByRange<StructureSpawn>(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_SPAWN,
			});

			if (spawn) {
				creep.whenInRange(1, spawn, () => {
					spawn.renewCreep(creep);
				});
				return;
			}
		}

		// If there's nothing to do, move back to spawn room center.
		creep.whenInRange(5, new RoomPosition(25, 25, creep.pos.roomName), () => {});
	}

	/**
	 * Makes a creep try to attack its designated target.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {RoomObject} target
	 *   Target to try and attack.
	 *
	 * @return {boolean}
	 *   True if an attack or ranged attack was made.
	 */
	attackMilitaryTarget(creep: BrawlerCreep, target: Creep | AnyStructure) {
		if (target instanceof StructureController) {
			if (target.owner && creep.attackController(target) === OK) {
				return true;
			}

			// If attack flag is directly on controller, claim it, otherwise just reserve.
			if (creep.memory.squadName) {
				const squad = this.squadManager.getSquad(creep.memory.squadName);
				const targetPos = squad && squad.getTarget();
				if (targetPos && targetPos.getRangeTo(target) === 0) {
					if (target.reservation && target.reservation.username !== getUsername()) {
						creep.attackController(target);
						return true;
					}

					if (creep.claimController(target) === OK) {
						return true;
					}
				}
			}
			else if (creep.reserveController(target) === OK) {
				return true;
			}
		}
		else if (!('owner' in target) || !hivemind.relations.isAlly(target.owner.username)) {
			if (creep.getActiveBodyparts(ATTACK) && creep.attack(target) === OK) {
				return true;
			}

			if (creep.getActiveBodyparts(RANGED_ATTACK) && creep.rangedAttack(target) === OK) {
				return true;
			}
		}

		return false;
	}
}
