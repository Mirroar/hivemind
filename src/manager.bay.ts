/* global RoomVisual FIND_STRUCTURES STRUCTURE_EXTENSION STRUCTURE_SPAWN
OBSTACLE_OBJECT_TYPES LOOK_STRUCTURES RESOURCE_ENERGY STRUCTURE_TOWER
STRUCTURE_LINK STRUCTURE_CONTAINER */

declare global {
	interface Room {
		bays: Bay[],
	}
}

import cache from 'cache';
import utilities from 'utilities';

const bayStructures = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_LINK, STRUCTURE_CONTAINER];

export default class Bay {

	pos: RoomPosition;
	name: string;
	_hasHarvester: boolean;
	extensions: AnyOwnedStructure[];
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
	constructor(pos, hasHarvester) {
		this.pos = pos;
		this.name = utilities.encodePosition(pos);
		this._hasHarvester = hasHarvester;

		const bayExtensions = cache.inHeap(
			'bay' + this.name,
			100,
			() => {
				const extensions = this.pos.findInRange(FIND_STRUCTURES, 1, {
					filter: structure => (bayStructures as string[]).indexOf(structure.structureType) > -1 && structure.isOperational(),
				});
				return _.map(extensions, 'id');
			}
		);

		// Do not add extensions to bay if center is blocked by a structure.
		const posStructures = this.pos.lookFor(LOOK_STRUCTURES);
		let blocked = false;
		for (const structure of posStructures) {
			if ((OBSTACLE_OBJECT_TYPES as string[]).indexOf(structure.structureType) !== -1) {
				blocked = true;
				break;
			}
		}

		this.extensions = [];
		this.energy = 0;
		this.energyCapacity = 0;

		if (blocked) return;

		for (const id of bayExtensions) {
			const extension: StructureExtension = Game.getObjectById(id);
			if (!extension) continue;

			this.extensions.push(extension);

			if (extension.energyCapacity) {
				if (extension.structureType === STRUCTURE_EXTENSION || extension.structureType === STRUCTURE_SPAWN) {
					this.energy += extension.energy;
					this.energyCapacity += extension.energyCapacity;
				}
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

	/**
	 * Checks if an extension is part of this bay.
	 *
	 * @param {Structure} extension
	 *   The structure to check.
	 *
	 * @return {boolean}
	 *   True if this extension is registered with this bay.
	 */
	hasExtension(extension) {
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
	hasHarvester() {
		return this._hasHarvester;
	}

	/**
	 * Checks if this bay needs to be filled with more energy.
	 *
	 * @return {boolean}
	 *   True if more energy is neeeded.
	 */
	needsRefill() {
		return this.energy < this.energyCapacity;
	}

	/**
	 * Refills this bay using energy carried by the given creep.
	 *
	 * @param {Creep} creep
	 *   A creep with carry parts and energy in store.
	 */
	refillFrom(creep) {
		const needsRefill = _.filter(this.extensions, (e: AnyStoreStructure) => {
			if (e.store) return e.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

			return false;
		});

		const target = _.min(needsRefill, e => (bayStructures as string[]).indexOf(e.structureType));

		creep.transfer(target, RESOURCE_ENERGY);
	}
}
