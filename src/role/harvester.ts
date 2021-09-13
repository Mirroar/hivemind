/* global FIND_STRUCTURES STRUCTURE_LINK RESOURCE_ENERGY LOOK_CREEPS
STRUCTURE_CONTAINER FIND_CONSTRUCTION_SITES LOOK_RESOURCES LOOK_STRUCTURES */

// @todo Rewrite delivery part using transporter logic.
// @todo Just make the harvester build a container when none is available.
// @todo Merge fixedMineralSource into fixedSource.
// @todo Stop harvesting when container and link are full.

import Role from 'role/role';
import TransporterRole from 'role/transporter';
import utilities from 'utilities';

export default class HarvesterRole extends Role {
	transporterRole: TransporterRole;

	constructor() {
		super();

		// Harvesting energy is essential and doesn't need tons of CPU.
		this.stopAt = 0;
		this.throttleAt = 2000;

		this.transporterRole = new TransporterRole();
	}

	/**
	 * Makes a creep behave like a harvester.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		this.transporterRole.creep = creep;

		const carryAmount = creep.store.getUsedCapacity();
		if (!creep.memory.harvesting && carryAmount <= 0) {
			this.setHarvesterState(creep, true);
		}
		else if (creep.memory.harvesting && carryAmount >= creep.store.getCapacity()) {
			// Have harvester explicitly deliver resources, unless it's a fixed energy
			// harvester with no need to move.
			if (creep.memory.fixedSource && _.size(creep.room.creepsByRole.transporter) === 0) {
				this.setHarvesterState(creep, false);
			}
		}

		if (creep.memory.harvesting) {
			this.performHarvest(creep);
			return;
		}

		this.performHarvesterDeliver(creep);
	}

	/**
	 * Determines where a harvester's fixed position should be.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Source} source
	 *   The source this harvester is assigned to.
	 */
	determineHarvestPosition(creep, source) {
		if (creep.memory.harvestPos || creep.memory.noHarvestPos) return;
		if (!creep.room.roomPlanner) return;

		const sourceMemory = creep.room.roomPlanner.memory.sources;
		if (sourceMemory && sourceMemory[source.id]) {
			creep.memory.harvestPos = sourceMemory[source.id].harvestPos;
		}

		if (!creep.memory.harvestPos) {
			creep.memory.noHarvestPos = true;
		}
	}

	/**
	 * Puts this creep into or out of harvesting mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} harvesting
	 *   Whether this creep should be harvesting.
	 */
	setHarvesterState(creep, harvesting) {
		creep.memory.harvesting = harvesting;
		delete creep.memory.resourceTarget;
		delete creep.memory.deliverTarget;
	}

	/**
	 * Makes the creep gather resources in the current room.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performHarvest(creep) {
		let source;
		if (creep.memory.fixedSource) {
			source = Game.getObjectById(creep.memory.fixedSource);
			// @todo Just in case, handle source not existing anymore.
		}
		else if (creep.memory.fixedMineralSource) {
			source = Game.getObjectById(creep.memory.fixedMineralSource);
			// @todo Just in case, handle source not existing anymore, or missing extractor.
		}

		this.determineHarvestPosition(creep, source);

		// By default, just move to range 1 of the source.
		let targetPos = source.pos;
		let targetRange = 1;

		// If available, move onto a harvest position.
		if (creep.memory.harvestPos) {
			const harvestPosition = utilities.deserializePosition(creep.memory.harvestPos, creep.room.name);
			if (harvestPosition.lookFor(LOOK_CREEPS).length === 0) {
				targetPos = harvestPosition;
				targetRange = 0;
			}
		}

		creep.whenInRange(targetRange, targetPos, () => {
			creep.harvest(source);

			// If there's a harvester bay, transfer resources into it.
			if (this.depositInBay(creep)) return;

			// If there's a link or container nearby, directly deposit resources.
			this.depositResources(creep, source);
		});
	}

	/**
	 * Deposits energy in a harvester's bay.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   True if the harvester is in a bay.
	 */
	depositInBay(creep: Creep) {
		if (!creep.memory.harvestPos) return false;
		const harvestPosition = utilities.deserializePosition(creep.memory.harvestPos, creep.room.name);
		const bay = _.find(creep.room.bays, bay => bay.name === utilities.encodePosition(harvestPosition));

		if (!bay) return false;
		if (creep.pos.x !== bay.pos.x || creep.pos.y !== bay.pos.y) return false;

		if (creep.store.getUsedCapacity() > creep.store.getCapacity() * (bay.needsRefill() ? 0.3 : 0.8)) bay.refillFrom(creep);
		if (bay.needsRefill()) this.pickupEnergy(creep);

		return true;
	}

	/**
	 * Makes a harvester pickup energy from the ground or a close container.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	pickupEnergy(creep: Creep) {
		const resources = creep.pos.lookFor(LOOK_RESOURCES);
		const energy = _.find(resources, r => r.resourceType === RESOURCE_ENERGY);
		if (energy) {
			creep.pickup(energy);
			return;
		}

		const structures = creep.pos.lookFor(LOOK_STRUCTURES);
		const container = _.find(structures, s => s.structureType === STRUCTURE_CONTAINER);
		if (container && ((container as StructureContainer).store.energy || 0) > 0) {
			creep.withdraw(container, RESOURCE_ENERGY);
		}
	}

	/**
	 * Makes a harvester deposit resources in nearby structures.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Source} source
	 *   The source this harvester is assigned to.
	 */
	depositResources(creep, source) {
		if (creep.store.getFreeCapacity() > creep.store.getCapacity() * 0.5) return;

		const targetContainer = source.getNearbyContainer();

		if (!targetContainer && creep.store.energy > 0) {
			// Check if there is a container construction site nearby and help build it.
			const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 3, {
				filter: site => site.structureType === STRUCTURE_CONTAINER,
			});

			if (sites.length > 0) {
				creep.whenInRange(3, sites[0], () => creep.build(sites[0]));
				return;
			}
		}

		let target = source.getNearbyContainer();
		if (creep.store.energy > 0) {
			const link = source.getNearbyLink();
			if (link && link.energy < link.energyCapacity) {
				target = link;
			}
			else {
				// Check for other nearby links.
				const links = source.pos.findInRange(FIND_STRUCTURES, 3, {filter: structure => structure.structureType === STRUCTURE_LINK && structure.energy < structure.energyCapacity});
				if (links.length > 0) {
					target = links[0];
				}
			}
		}

		if (target) {
			const distance = creep.pos.getRangeTo(target);
			creep.whenInRange(1, target, () => {
				if (target.structureType === STRUCTURE_CONTAINER && distance === 0) {
					// Nothing to do, resources will drop into the container.
				}
				else {
					creep.transferAny(target);
				}
			});
		}
	}

	/**
	 * Dumps resources a harvester creep has gathered.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performHarvesterDeliver(creep) {
		if (!creep.memory.fixedSource) return;

		if (_.size(creep.room.creepsByRole.transporter) === 0) {
			// Use transporter drop off logic.
			this.transporterRole.performDeliver();
			return;
		}

		this.setHarvesterState(creep, true);
	}
}
