/* global RoomVisual FIND_STRUCTURES STRUCTURE_EXTENSION STRUCTURE_SPAWN
OBSTACLE_OBJECT_TYPES LOOK_STRUCTURES RESOURCE_ENERGY STRUCTURE_TOWER
STRUCTURE_LINK STRUCTURE_CONTAINER */

import cache from 'utils/cache';
import {encodePosition} from 'utils/serialization';

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
				const extensions = this.pos.findInRange(FIND_STRUCTURES, 1, {
					filter: structure => (bayStructures as string[]).includes(structure.structureType) && structure.isOperational(),
				});
				return _.map<AnyStructure, Id<AnyStructure>>(extensions, 'id');
			},
		);

		if (this.isBlocked()) return;

		for (const id of bayExtensions) {
			const extension = Game.getObjectById<AnyBayStructure>(id);
			if (!extension) continue;

			this.extensions.push(extension);

			if (extension instanceof StructureExtension || extension instanceof StructureSpawn) {
				this.energy += extension.energy;
				this.energyCapacity += extension.store.getCapacity(RESOURCE_ENERGY);
			}
		}

		// Draw bay.
		// @todo Move out of constructor into separate function, called in owned rooms
		// process.
		if (typeof RoomVisual !== 'undefined') {
			const visual = new RoomVisual(this.pos.roomName);
			visual.rect(this.pos.x - 1.4, this.pos.y - 1.4, 2.8, 2.8, {
				fill: 'rgba(255, 255, 128, 0.2)',
				opacity: 0.5,
				stroke: '#ffff80',
			});
		}
	}

	isBlocked(): boolean {
		return cache.inHeap('bay-blocked:' + this.name, 100, () => {
			// Do not add extensions to bay if center is blocked by a structure.
			const posStructures = this.pos.lookFor(LOOK_STRUCTURES);
			for (const structure of posStructures) {
				if ((OBSTACLE_OBJECT_TYPES as string[]).includes(structure.structureType)) {
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
	 *   True if more energy is neeeded.
	 */
	needsRefill(): boolean {
		return this.energy < this.energyCapacity;
	}

	/**
	 * Refills this bay using energy carried by the given creep.
	 *
	 * @param {Creep} creep
	 *   A creep with carry parts and energy in store.
	 */
	refillFrom(creep: Creep) {
		const needsRefill = _.filter(this.extensions, (extension: AnyStoreStructure) => {
			if (extension.store) return extension.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

			return false;
		});

		const target = _.min(needsRefill, extension => (bayStructures as string[]).indexOf(extension.structureType));

		creep.transfer(target, RESOURCE_ENERGY);
	}
}
