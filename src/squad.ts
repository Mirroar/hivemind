import {encodePosition, decodePosition} from 'utils/serialization';
import {Squad as SquadInterface} from 'manager.squad';

declare global {
	namespace NodeJS {
		interface Global {
			Squad: typeof Squad;
		}
	}

	interface SquadMemory {
		composition: Partial<Record<SquadUnitType, number>>;
		spawnRoom?: string;
		targetPos?: string;
	}
}

export default class Squad implements SquadInterface {
	name: string;
	memory: SquadMemory;

	/**
	 * Squads are sets of creeps spawned in a single room.
	 * @constructor
	 *
	 * @param {string}squadName
	 *   Identifier of this squad for memory.
	 */
	constructor(squadName: string) {
		this.name = squadName;

		if (!Memory.squads) {
			Memory.squads = {};
		}

		if (!Memory.squads[squadName]) {
			Memory.squads[squadName] = {
				composition: {},
			};
		}

		this.memory = Memory.squads[squadName];
	}

	getName(): string {
		return this.name;
	}

	/**
	 * Adds one unit of a certain type to the squad's composition.
	 *
	 * @param {string} unitType
	 *   Type identifier of the unit to add.
	 *
	 * @return {number}
	 *   New amount of units of the specified type in the squad.
	 */
	addUnit(unitType: SquadUnitType): number {
		if (!this.memory.composition[unitType]) {
			this.memory.composition[unitType] = 0;
		}

		this.memory.composition[unitType]++;

		return this.memory.composition[unitType];
	}

	/**
	 * Removes one unit of a certain type from the squad's composition.
	 *
	 * @param {string} unitType
	 *   Type identifier of the unit to remove.
	 *
	 * @return {number}
	 *   New amount of units of the specified type in the squad.
	 */
	removeUnit(unitType: SquadUnitType): number {
		if (!this.memory.composition[unitType]) {
			return 0;
		}

		this.memory.composition[unitType]--;

		return this.memory.composition[unitType];
	}

	/**
	 * Set the number of requested units of a certain type.
	 *
	 * @param {string} unitType
	 *   Type identifier of the unit to modify.
	 * @param {number} count
	 *   Number of units of the chosen type that should be in this squad.
	 */
	setUnitCount(unitType: SquadUnitType, count: number) {
		this.memory.composition[unitType] = count;
	}

	getUnitCount(unitType: SquadUnitType) {
		return this.memory.composition[unitType] || 0;
	}

    getComposition(): Partial<Record<SquadUnitType, number>> {
        return this.memory.composition;
    }

	/**
	 * Clears all registered units for this squad.
	 */
	clearUnits() {
		this.memory.composition = {};
	}

	/**
	 * Stops spawning units and removes a squad completely.
	 */
	disband() {
		this.clearUnits();
		this.setSpawn(null);
		this.setTarget(null);
		// @todo Recycle units, then clear memory.
	}

	/**
	 * Gets current squad orders with priorities.
	 *
	 * @return {Array}
	 *   An array of objects containing squad orders.
	 */
	getOrders() {
		// @todo This is really not used anymore.
		// Check if there is a target for this squad.
		const targetPos = this.getTarget();
		if (!targetPos) return [];

		return [{
			priority: 5,
			weight: 0,
			target: encodePosition(targetPos),
		}];
	}

	/**
	 * Orders squad to spawn in the given room.
	 *
	 * @param {string} roomName
	 *   Name of the room to spawn in.
	 */
	setSpawn(roomName: string) {
		this.memory.spawnRoom = roomName;
	}

	/**
	 * Determines which room the squad is set to spawn in.
	 *
	 * @return {string}
	 *   Name of the room the squad spawns in.
	 */
	getSpawn(): string {
		return this.memory.spawnRoom;
	}

	/**
	 * Orders squad to move toward the given position.
	 *
	 * @param {RoomPosition} targetPos
	 *   Position the squad is supposed to move to.
	 */
	setTarget(targetPos: RoomPosition) {
		if (targetPos) {
			this.memory.targetPos = encodePosition(targetPos);
		}
		else {
			delete this.memory.targetPos;
		}
	}

	/**
	 * Determines which room position the squad is currently targeting.
	 *
	 * @return {RoomPosition}
	 *   Position the squad is supposed to move to.
	 */
	getTarget(): RoomPosition {
		if (this.memory.targetPos) {
			return decodePosition(this.memory.targetPos);
		}

		return null;
	}
}

global.Squad = Squad;
