/* global FIND_STRUCTURES STRUCTURE_EXTENSION STRUCTURE_SPAWN
LOOK_STRUCTURES RESOURCE_ENERGY STRUCTURE_TOWER
STRUCTURE_LINK STRUCTURE_CONTAINER */

import cache from 'utils/cache';
import {encodePosition} from 'utils/serialization';
import {handleMapArea} from 'utils/map';

declare global {
	interface Room {
		bays: Bay[];
	}

	type BayStructureConstant = typeof bayStructures[number];
	type AnyBayStructure = ConcreteStructure<BayStructureConstant>;
}

const bayStructures = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_LINK, STRUCTURE_CONTAINER];
const problematicStructures = [STRUCTURE_STORAGE, STRUCTURE_TERMINAL, STRUCTURE_FACTORY, STRUCTURE_LAB, STRUCTURE_NUKER, STRUCTURE_POWER_SPAWN];

export default class Bay {
	readonly pos: RoomPosition;
	readonly name: string;
	_hasHarvester: boolean;
	readonly extensions: AnyBayStructure[];
	energy: number;
	energyCapacity: number;

	/**
	 * Bays collect extensions into a single entity for more efficient refilling.
	 * @constructor
	 *
	 * @param {RoomPosition} pos
	 *   Room position around which this bay is placed.
	 * @param {boolean} hasHarvester
	 *   Whether a harvester is in this bay to fill it.
	 */
	constructor(pos: RoomPosition, hasHarvester: boolean) {
		this.pos = pos;
		this.name = encodePosition(pos);
		this._hasHarvester = hasHarvester;
		this.extensions = [];
		this.energy = 0;
		this.energyCapacity = 0;

		const bayExtensions = cache.inHeap(
			'bay-extensions:' + this.name,
			250,
			() => {
				const room = Game.rooms[this.pos.roomName];
				let ids: Array<Id<AnyBayStructure>> = [];
				for (const structureType of bayStructures) {
					for (const structure of (room.structuresByType[structureType]) || []) {
						if (structure.pos.getRangeTo(this.pos) > 1) continue;
						if (!structure.isOperational()) continue;

						ids.push(structure.id);
					}
				}

				return ids;
			},
		);

		if (this.isBlocked()) return;

		for (const id of bayExtensions) {
			const extension = Game.getObjectById<AnyBayStructure>(id);
			if (!extension) continue;

			this.extensions.push(extension);

			if (extension instanceof StructureExtension || extension instanceof StructureSpawn) {
				this.energy += extension.store.getUsedCapacity(RESOURCE_ENERGY);
				this.energyCapacity += extension.store.getCapacity(RESOURCE_ENERGY);
			}
		}
	}

	isBlocked(): boolean {
		return cache.inHeap('bay-blocked:' + this.name, 100, () => {
			// Do not add extensions to bay if center is blocked by a structure.
			const posStructures = this.pos.lookFor(LOOK_STRUCTURES);
			for (const structure of posStructures) {
				if (!structure.isWalkable()) {
					return true;
				}
			}

			// Do not add extensions to bay if another important structure is in the bay.
			const importantStructures = this.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: structure => (problematicStructures as string[]).includes(structure.structureType) && structure.isOperational(),
			});
			return importantStructures.length > 0;
		});
	}

	/**
	 * Checks if an extension is part of this bay.
	 *
	 * @param {Structure} extension
	 *   The structure to check.
	 *
	 * @return {boolean}
	 *   True if this extension is registered with this bay.
	 */
	hasExtension(extension: AnyBayStructure): boolean {
		for (const ourExtension of this.extensions) {
			if (ourExtension.id === extension.id) return true;
		}

		return false;
	}

	/**
	 * Checks if a harvester is in this bay.
	 *
	 * @return {boolean}
	 *   True if a harvester is in this bay.
	 */
	hasHarvester(): boolean {
		return this._hasHarvester;
	}

	/**
	 * Checks if this bay needs to be filled with more energy.
	 *
	 * @return {boolean}
	 *   True if more energy is needed.
	 */
	needsRefill(): boolean {
		return this.energy < this.energyCapacity;
	}

	/**
	 * Refills this bay using energy carried by the given creep.
	 *
	 * @param {Creep} creep
	 *   A creep with carry parts and energy in store.
	 * @return {boolean}
	 *   True if more energy is needed.
	 */
	refillFrom(creep: Creep) {
		const needsRefill = this.getStructuresNeedingRefill();
		if (needsRefill.length === 0) return false;

		const target = _.min(needsRefill, extension => (bayStructures as string[]).indexOf(extension.structureType));
		const targetCapacity = target.store.getFreeCapacity(RESOURCE_ENERGY);
		const amount = Math.min(creep.store.getUsedCapacity(RESOURCE_ENERGY), targetCapacity);
		const isLastTransfer = amount >= this.energyCapacity - this.energy || amount === creep.store.getUsedCapacity(RESOURCE_ENERGY);
		if (creep.transfer(target, RESOURCE_ENERGY) === OK && isLastTransfer) return false;

		return true;
	}

	getStructuresNeedingRefill() {
		return _.filter(this.extensions, (extension: AnyBayStructure) => {
			if (extension.store) return extension.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

			return false;
		});
	}

	getExitPosition(): RoomPosition {
		const coords = cache.inHeap('exitCoords:' + this.name, 500, () => {
			let exitCoords;
			const room = Game.rooms[this.pos.roomName];
			handleMapArea(this.pos.x, this.pos.y, (x, y) => {
				const position = new RoomPosition(x, y, this.pos.roomName);
				if (room?.roomPlanner?.isPlannedLocation(position, 'road')) exitCoords = {x: position.x, y: position.y};
			});

			return exitCoords;
		});

		return new RoomPosition(coords.x, coords.y, this.pos.roomName);
	}
}
