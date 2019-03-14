'use strict';

/* global hivemind Creep Room RoomPosition FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER RESOURCE_POWER RESOURCE_GHODIUM STRUCTURE_LAB REACTIONS
STRUCTURE_EXTENSION STRUCTURE_SPAWN STRUCTURE_TOWER STRUCTURE_NUKER ERR_NO_PATH
STRUCTURE_POWER_SPAWN TERRAIN_MASK_WALL LOOK_STRUCTURES RESOURCE_ENERGY
LOOK_CONSTRUCTION_SITES FIND_STRUCTURES OK OBSTACLE_OBJECT_TYPES
FIND_TOMBSTONES */

const utilities = require('./utilities');

/**
 * Creates a priority list of energy sources available to this creep.
 *
 * @return {Array}
 *   A list of potential energy sources.
 */
Creep.prototype.getAvailableEnergySources = function () {
	const creep = this;
	const options = [];

	let storagePriority = 0;
	if (creep.room.energyAvailable < creep.room.energyCapacityAvailable * 0.9) {
		// Spawning is important, so get energy when needed.
		storagePriority = 4;
	}
	else if (creep.room.terminal && creep.room.storage && creep.room.terminal.store.energy < creep.room.storage.store.energy * 0.05) {
		// Take some energy out of storage to put into terminal from time to time.
		storagePriority = 2;
	}

	// Energy can be gotten at the room's storage or terminal.
	const storageTarget = creep.room.getBestStorageSource(RESOURCE_ENERGY);
	if (storageTarget && storageTarget.store.energy >= creep.carryCapacity - _.sum(creep.carry)) {
		// Only transporters can get the last bit of energy from storage, so spawning can always go on.
		if (creep.memory.role === 'transporter' || storageTarget.store.energy > 5000 || !creep.room.storage || storageTarget.id !== creep.room.storage.id) {
			options.push({
				priority: creep.memory.role === 'transporter' ? storagePriority : 5,
				weight: 0,
				type: 'structure',
				object: storageTarget,
				resourceType: RESOURCE_ENERGY,
			});
		}
	}

	this.addDroppedEnergySourceOptions(options, storagePriority);
	this.addTombstoneEnergySourceOptions(options);
	this.addContainerEnergySourceOptions(options);

	// Take energy from storage links.
	if (creep.room.linkNetwork && creep.room.linkNetwork.energy > creep.room.linkNetwork.maxEnergy) {
		for (const link of creep.room.linkNetwork.neutralLinks) {
			if (link.energy === 0) continue;

			const option = {
				priority: 5,
				weight: link.energy / 100, // @todo Also factor in distance.
				type: 'structure',
				object: link,
				resourceType: RESOURCE_ENERGY,
			};

			if (creep.pos.getRangeTo(link) > 10) {
				// Don't go out of your way to empty the link, do it when nearby, e.g. at storage.
				option.priority--;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', link.id).length * 2;

			options.push(option);
		}
	}

	return options;
};

/**
 * Adds options for picking up dropped energy to priority list.
 *
 * @param {Array} options
 *   A list of potential energy sources.
 * @param {number} storagePriority
 *   Priority assigned for transporters picking up from storage.
 */
Creep.prototype.addDroppedEnergySourceOptions = function (options, storagePriority) {
	const creep = this;

	// Get storage location, since that is a low priority source for transporters.
	const storagePosition = creep.room.getStorageLocation();

	// Look for energy on the ground.
	const targets = creep.room.find(FIND_DROPPED_RESOURCES, {
		filter: resource => {
			if (resource.resourceType === RESOURCE_ENERGY) {
				if (creep.pos.findPathTo(resource)) return true;
			}

			return false;
		},
	});

	for (const target of targets) {
		const option = {
			priority: 4,
			weight: target.amount / 100, // @todo Also factor in distance.
			type: 'resource',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		if (storagePosition && target.pos.x === storagePosition.x && target.pos.y === storagePosition.y) {
			if (creep.memory.role === 'transporter') {
				option.priority = storagePriority;
			}
			else {
				option.priority = 5;
			}
		}
		else {
			if (target.amount < 100) {
				option.priority--;
			}

			if (target.amount < 200) {
				option.priority--;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;
		}

		if (creep.room.getFreeStorage() < target.amount) {
			// If storage is super full, try leaving stuff on the ground.
			option.priority -= 2;
		}

		options.push(option);
	}
};

/**
 * Adds options for picking up energy from tombstones to priority list.
 *
 * @param {Array} options
 *   A list of potential energy sources.
 */
Creep.prototype.addTombstoneEnergySourceOptions = function (options) {
	const creep = this;

	// Look for energy on the ground.
	const targets = creep.room.find(FIND_TOMBSTONES, {
		filter: tomb => {
			if (tomb.store.energy > 0) {
				if (creep.pos.findPathTo(tomb)) return true;
			}

			return false;
		},
	});

	for (const target of targets) {
		const option = {
			priority: 4,
			weight: target.store.energy / 100, // @todo Also factor in distance.
			type: 'tombstone',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		if (target.amount < 100) {
			option.priority--;
		}

		if (target.amount < 200) {
			option.priority--;
		}

		option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;

		if (creep.room.getFreeStorage() < target.amount) {
			// If storage is super full, try leaving stuff on the ground.
			option.priority -= 2;
		}

		options.push(option);
	}
};

/**
 * Adds options for picking up energy from containers to priority list.
 *
 * @param {Array} options
 *   A list of potential energy sources.
 */
Creep.prototype.addContainerEnergySourceOptions = function (options) {
	const creep = this;

	// Look for energy in Containers.
	const targets = creep.room.find(FIND_STRUCTURES, {
		filter: structure => {
			return (structure.structureType === STRUCTURE_CONTAINER) && structure.store[RESOURCE_ENERGY] > creep.carryCapacity * 0.1;
		},
	});

	// Prefer containers used as harvester dropoff.
	for (const target of targets) {
		// Don't use the controller container as a normal source if we're upgrading.
		if (target.id === target.room.memory.controllerContainer && creep.room.creepsByRole.upgrader) continue;

		const option = {
			priority: 1,
			weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
			type: 'structure',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		for (const sourceData of _.values(target.room.memory.sources)) {
			if (sourceData.targetContainer !== target.id) continue;

			option.priority = 2;
			if (_.sum(target.store) >= creep.carryCapacity - _.sum(creep.carry)) {
				// This container is filling up, prioritize emptying it.
				option.priority += 2;
			}

			break;
		}

		option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;

		options.push(option);
	}
};

/**
 * Creates a priority list of resources available to this creep.
 *
 * @return {Array}
 *   A list of potential resource sources.
 */
Creep.prototype.getAvailableSources = function () {
	const creep = this;
	const options = creep.getAvailableEnergySources();

	// Clear out overfull terminal.
	const terminal = creep.room.terminal;
	const storage = creep.room.storage;
	if (terminal && (_.sum(terminal.store) > terminal.storeCapacity * 0.8 || creep.room.isClearingTerminal()) && !creep.room.isEvacuating()) {
		// Find resource with highest count and take that.
		// @todo Unless it's supposed to be sent somewhere else.
		let max = null;
		let maxResourceType = null;
		for (const resourceType in terminal.store) {
			// Do not take out energy if there is enough in storage.
			if (resourceType === RESOURCE_ENERGY && storage.store[RESOURCE_ENERGY] > terminal.store[RESOURCE_ENERGY] * 5) continue;
			if (resourceType === creep.room.memory.fillTerminal) continue;

			if (!max || terminal.store[resourceType] > max) {
				max = terminal.store[resourceType];
				maxResourceType = resourceType;
			}
		}

		const option = {
			priority: 1,
			weight: 0,
			type: 'structure',
			object: terminal,
			resourceType: maxResourceType,
		};

		if (creep.room.isClearingTerminal()) {
			option.priority = 3;
		}

		options.push(option);
	}

	// @todo Take resources from storage if terminal is relatively empty.

	// Take resources from storage to terminal for transfer if requested.
	if (creep.room.memory.fillTerminal && !creep.room.isClearingTerminal()) {
		const resourceType = creep.room.memory.fillTerminal;
		if (storage && terminal && storage.store[resourceType]) {
			if ((storage.store[resourceType] > this.carryCapacity || creep.room.isEvacuating()) && _.sum(terminal.store) < terminal.storeCapacity - 10000) {
				options.push({
					priority: 4,
					weight: 0,
					type: 'structure',
					object: storage,
					resourceType,
				});
			}
		}
		else {
			// No more of these resources can be taken into terminal.
			delete creep.room.memory.fillTerminal;
		}
	}

	this.addDroppedResourceOptions(options);
	this.addTombstoneResourceOptions(options);
	this.addContainerResourceOptions(options);
	this.addHighLevelResourceOptions(options);
	this.addEvacuatingRoomResourceOptions(options);
	this.addLabResourceOptions(options);

	return options;
};

/**
 * Adds options for picking up dropped resources to priority list.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 */
Creep.prototype.addDroppedResourceOptions = function (options) {
	const creep = this;

	// Look for resources on the ground.
	const targets = creep.room.find(FIND_DROPPED_RESOURCES, {
		filter: resource => {
			if (resource.amount > 10 && creep.pos.findPathTo(resource)) {
				return true;
			}

			return false;
		},
	});

	for (const target of targets) {
		const option = {
			priority: 4,
			weight: target.amount / 30, // @todo Also factor in distance.
			type: 'resource',
			object: target,
			resourceType: target.resourceType,
		};

		if (target.resourceType === RESOURCE_POWER) {
			option.priority++;
		}

		if (creep.room.getFreeStorage() < target.amount) {
			// If storage is super full, try leaving stuff on the ground.
			option.priority -= 2;
		}

		options.push(option);
	}
};

/**
 * Adds options for picking up resources from tombstones to priority list.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 */
Creep.prototype.addTombstoneResourceOptions = function (options) {
	const creep = this;

	// Look for resources on the ground.
	const targets = creep.room.find(FIND_TOMBSTONES, {
		filter: tomb => {
			if (_.sum(tomb.store) > 10 && creep.pos.findPathTo(tomb)) {
				return true;
			}

			return false;
		},
	});

	for (const target of targets) {
		for (const resourceType of _.keys(target.store)) {
			if (resourceType === RESOURCE_ENERGY) continue;
			if (target.store[resourceType] === 0) continue;

			const option = {
				priority: 4,
				weight: target.store[resourceType] / 30, // @todo Also factor in distance.
				type: 'resource',
				object: target,
				resourceType,
			};

			if (resourceType === RESOURCE_POWER) {
				option.priority++;
			}

			if (creep.room.getFreeStorage() < target.store[resourceType]) {
				// If storage is super full, try leaving stuff on the ground.
				option.priority -= 2;
			}

			options.push(option);
		}
	}
};

/**
 * Adds options for picking up resources from containers to priority list.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 */
Creep.prototype.addContainerResourceOptions = function (options) {
	// We need a decent place to store these resources.
	if (!this.room.terminal && !this.room.storage) return;

	// Take non-energy out of containers.
	const containers = this.room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER,
	});

	for (const container of containers) {
		for (const resourceType of _.keys(container.store)) {
			if (resourceType === RESOURCE_ENERGY) continue;
			if (container.store[resourceType] === 0) continue;

			const option = {
				priority: 3,
				weight: container.store[resourceType] / 20, // @todo Also factor in distance.
				type: 'structure',
				object: container,
				resourceType,
			};

			options.push(option);
		}
	}
};

/**
 * Adds options for picking up resources for nukers and power spawns.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 */
Creep.prototype.addHighLevelResourceOptions = function (options) {
	const creep = this;

	// Take ghodium if nuker needs it.
	if (creep.room.nuker && creep.room.nuker.ghodium < creep.room.nuker.ghodiumCapacity) {
		const target = creep.room.getBestStorageSource(RESOURCE_GHODIUM);
		if (target && target.store[RESOURCE_GHODIUM] > 0) {
			const option = {
				priority: 2,
				weight: 0, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_GHODIUM,
			};

			options.push(option);
		}
	}

	// Take power if power spawn needs it.
	if (creep.room.powerSpawn && creep.room.powerSpawn.power < creep.room.powerSpawn.powerCapacity * 0.1) {
		const target = creep.room.getBestStorageSource(RESOURCE_POWER);
		if (target && target.store.power > 0) {
			// @todo Limit amount since power spawn can only hold 100 power at a time.
			// @todo Make sure only 1 creep does this at a time.
			const option = {
				priority: 3,
				weight: 0, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_POWER,
			};

			if (creep.room.isFullOnPower()) {
				option.priority++;
			}

			options.push(option);
		}
	}
};

/**
 * Adds options for picking up resources for moving to terminal.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 */
Creep.prototype.addEvacuatingRoomResourceOptions = function (options) {
	const creep = this;
	if (!creep.room.isEvacuating()) return;

	// Take everything out of labs.
	const labs = creep.room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LAB,
	});

	for (const lab of labs) {
		if (lab.energy > 0) {
			options.push({
				priority: 4,
				weight: 0,
				type: 'structure',
				object: lab,
				resourceType: RESOURCE_ENERGY,
			});
		}

		if (lab.mineralType) {
			options.push({
				priority: 4,
				weight: 0,
				type: 'structure',
				object: lab,
				resourceType: lab.mineralType,
			});
		}
	}

	// Also take everything out of storage.
	const storage = creep.room.storage;
	const terminal = creep.room.terminal;
	if (storage && terminal && _.sum(terminal.store) < terminal.storeCapacity * 0.8) {
		for (const resourceType in storage.store) {
			if (storage.store[resourceType] <= 0) continue;

			options.push({
				priority: 3,
				weight: 0,
				type: 'structure',
				object: storage,
				resourceType,
			});

			break;
		}
	}

	// @todo Destroy nuker once storage is empty so we can pick up contained resources.
};

/**
 * Adds options for picking up resources for lab management.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 */
Creep.prototype.addLabResourceOptions = function (options) {
	const creep = this;
	if (!creep.room.memory.canPerformReactions) return;
	if (creep.room.isEvacuating()) return;

	const labs = creep.room.memory.labs.reactor;
	for (const labID of labs) {
		// Clear out reaction labs.
		const lab = Game.getObjectById(labID);

		if (lab && lab.mineralAmount > 0) {
			const option = {
				priority: 0,
				weight: lab.mineralAmount / lab.mineralCapacity,
				type: 'structure',
				object: lab,
				resourceType: lab.mineralType,
			};

			if (lab.mineralAmount > lab.mineralCapacity * 0.3) {
				option.priority++;
			}

			if (lab.mineralAmount > lab.mineralCapacity * 0.6) {
				option.priority++;
			}

			if (lab.mineralAmount > lab.mineralCapacity * 0.9) {
				option.priority++;
			}

			if (creep.room.memory.currentReaction) {
				// If we're doing a different reaction now, clean out faster!
				if (REACTIONS[creep.room.memory.currentReaction[0]][creep.room.memory.currentReaction[1]] !== lab.mineralType) {
					option.priority = 4;
					option.weight = 0;
				}
			}

			options.push(option);
		}
	}

	// Clear out labs with wrong resources.
	let lab = Game.getObjectById(creep.room.memory.labs.source1);
	if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType !== creep.room.memory.currentReaction[0]) {
		const option = {
			priority: 3,
			weight: 0,
			type: 'structure',
			object: lab,
			resourceType: lab.mineralType,
		};

		options.push(option);
	}

	lab = Game.getObjectById(creep.room.memory.labs.source2);
	if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType !== creep.room.memory.currentReaction[1]) {
		const option = {
			priority: 3,
			weight: 0,
			type: 'structure',
			object: lab,
			resourceType: lab.mineralType,
		};

		options.push(option);
	}

	if (!creep.room.memory.currentReaction) return;

	// Get reaction resources.
	this.addSourceLabResourceOptions(options, Game.getObjectById(creep.room.memory.labs.source1), creep.room.memory.currentReaction[0]);
	this.addSourceLabResourceOptions(options, Game.getObjectById(creep.room.memory.labs.source2), creep.room.memory.currentReaction[1]);
};

/**
 * Adds options for getting reaction lab resources.
 *
 * @param {Array} options
 *   A list of potential resource sources.
 * @param {StructureLab} lab
 *   The lab to fill.
 * @param {string} resourceType
 *   The type of resource that should be put in the lab.
 */
Creep.prototype.addSourceLabResourceOptions = function (options, lab, resourceType) {
	if (!lab) return;
	if (lab.mineralType && lab.mineralType !== resourceType) return;
	if (lab.mineralAmount > lab.mineralCapacity * 0.5) return;

	const source = this.room.getBestStorageSource(resourceType);
	if (!source) return;
	if ((source.store[resourceType] || 0) === 0) return;

	const option = {
		priority: 3,
		weight: 1 - (lab.mineralAmount / lab.mineralCapacity),
		type: 'structure',
		object: source,
		resourceType,
	};

	if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
		option.priority--;
	}

	options.push(option);
};

/**
 * Sets a good energy source target for this creep.
 */
Creep.prototype.calculateEnergySource = function () {
	const creep = this;
	const best = utilities.getBestOption(creep.getAvailableEnergySources());

	if (best) {
		creep.memory.sourceTarget = best.object.id;

		creep.memory.order = {
			type: 'getEnergy',
			target: best.object.id,
			resourceType: best.resourceType,
		};
	}
	else {
		delete creep.memory.sourceTarget;
		delete creep.memory.order;
	}
};

/**
 * Sets a good resource source target for this creep.
 */
Creep.prototype.calculateSource = function () {
	const creep = this;
	const best = utilities.getBestOption(creep.getAvailableSources());

	if (best && best.object) {
		creep.memory.sourceTarget = best.object.id;

		creep.memory.order = {
			type: 'getResource',
			target: best.object.id,
			resourceType: best.resourceType,
		};
	}
	else {
		delete creep.memory.sourceTarget;
		delete creep.memory.order;
	}
};

/**
 * Makes this creep collect energy.
 */
Creep.prototype.performGetEnergy = function () {
	const creep = this;
	this.performGetResources(() => creep.calculateEnergySource());
};

/**
 * Makes this creep collect resources.
 *
 * @param {Function } calculateSourceCallback
 *   Optional callback to use when a new source target needs to be chosen.
 */
Creep.prototype.performGetResources = function (calculateSourceCallback) {
	const creep = this;
	if (!calculateSourceCallback) {
		calculateSourceCallback = () => creep.calculateSource();
	}

	if (!this.ensureValidResourceSource(calculateSourceCallback)) {
		delete creep.memory.sourceTarget;
		if (creep.memory.role === 'transporter' && _.sum(creep.carry) > 0) {
			// Deliver what we already have stored, if no more can be found for picking up.
			creep.setTransporterState(true);
		}

		return;
	}

	const target = Game.getObjectById(creep.memory.sourceTarget);
	if (creep.pos.getRangeTo(target) > 1) {
		creep.moveToRange(target, 1);
		return;
	}

	const resourceType = creep.memory.order && creep.memory.order.resourceType;
	let orderDone = false;
	if (target.amount) {
		orderDone = creep.pickup(target) === OK;
	}
	else {
		orderDone = creep.withdraw(target, resourceType) === OK;
	}

	if (orderDone) calculateSourceCallback();
};

/**
 * Makes sure the creep has a valid target for resource pickup.
 *
 * @param {Function } calculateSourceCallback
 *   Callback to use when a new source target needs to be chosen.
 *
 * @return {boolean}
 *   True if the target is valid and contains the needed resource.
 */
Creep.prototype.ensureValidResourceSource = function (calculateSourceCallback) {
	const creep = this;

	if (!creep.memory.sourceTarget) calculateSourceCallback();

	const target = Game.getObjectById(creep.memory.sourceTarget);
	const resourceType = creep.memory.order && creep.memory.order.resourceType;
	if (!target) return false;
	if (creep.memory.singleRoom && target.pos.roomName !== creep.memory.singleRoom) return false;

	if (target.store && (target.store[resourceType] || 0) > 0) return true;
	if (target.amount && target.amount > 0) return true;
	if (resourceType === RESOURCE_ENERGY && target.energyCapacity && target.energy > 0) return true;
	if (target.mineralCapacity && target.mineralType === resourceType && target.mineralAmount > 0) return true;

	return false;
};

/**
 * Creates a priority list of possible delivery targets for this creep.
 *
 * @return {Array}
 *   A list of potential delivery targets.
 */
Creep.prototype.getAvailableDeliveryTargets = function () {
	const creep = this;
	const options = [];

	const terminal = creep.room.terminal;

	if (creep.carry.energy > creep.carryCapacity * 0.1) {
		this.addSpawnBuildingDeliveryOptions(options);
		this.addContainerEnergyDeliveryOptions(options);
		this.addTowerDeliveryOptions(options);
		this.addHighLevelEnergyDeliveryOptions(options);
		this.addStorageEnergyDeliveryOptions(options);
		this.addLinkDeliveryOptions(options);
	}

	for (const resourceType of _.keys(creep.carry)) {
		// If it's needed for transferring, store in terminal.
		if (resourceType === creep.room.memory.fillTerminal && creep.carry[resourceType] > 0 && !creep.room.isClearingTerminal()) {
			if (terminal && (!terminal.store[resourceType] || terminal.store[resourceType] < (creep.room.memory.fillTerminalAmount || 10000)) && _.sum(terminal.store) < terminal.storeCapacity) {
				const option = {
					priority: 4,
					weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: terminal,
					resourceType,
				};
				options.push(option);
			}
			else {
				creep.room.stopTradePreparation();
			}
		}

		// The following only only concerns resources other than energy.
		if (resourceType === RESOURCE_ENERGY || creep.carry[resourceType] <= 0) continue;

		const storageTarget = creep.room.getBestStorageTarget(creep.carry[resourceType], resourceType);

		// If there is space left, store in storage.
		if (storageTarget && _.sum(storageTarget.store) < storageTarget.storeCapacity) {
			options.push({
				priority: 1,
				weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
				type: 'structure',
				object: storageTarget,
				resourceType,
			});
		}

		this.addHighLevelResourceDeliveryOptions(options, resourceType);
		this.addLabResourceDeliveryOptions(options, resourceType);

		// As a last resort, simply drop the resource since it can't be put anywhere.
		options.push({
			priority: 0,
			weight: 0,
			type: 'drop',
			resourceType,
		});
	}

	return options;
};

/**
 * Adds spawns and single extensions as delivery targets.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 */
Creep.prototype.addSpawnBuildingDeliveryOptions = function (options) {
	const creep = this;

	// Primarily fill spawn and extenstions.
	const targets = creep.room.find(FIND_STRUCTURES, {
		filter: structure => {
			return ((structure.structureType === STRUCTURE_EXTENSION && !structure.isBayExtension()) ||
					structure.structureType === STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
		},
	});

	for (const target of targets) {
		const canDeliver = Math.min(creep.carry.energy, target.energyCapacity - target.energy);

		const option = {
			priority: 5,
			weight: canDeliver / creep.carryCapacity,
			type: 'structure',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
		option.priority -= creep.room.getCreepsWithOrder('deliver', target.id).length * 3;

		options.push(option);
	}

	// Fill bays.
	for (const bay of creep.room.bays) {
		const target = bay;

		if (target.energy >= target.energyCapacity) continue;

		const canDeliver = Math.min(creep.carry.energy, target.energyCapacity - target.energy);

		const option = {
			priority: 5,
			weight: canDeliver / creep.carryCapacity,
			type: 'bay',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
		option.priority -= creep.room.getCreepsWithOrder('deliver', target.name).length * 3;

		options.push(option);
	}
};

/**
 * Adds options for filling containers with energy.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 */
Creep.prototype.addContainerEnergyDeliveryOptions = function (options) {
	const creep = this;
	const targets = creep.room.find(FIND_STRUCTURES, {
		filter: structure => {
			if (structure.structureType !== STRUCTURE_CONTAINER || structure.store.energy >= structure.storeCapacity) return false;

			// Do deliver to controller containers when it is needed.
			if (structure.id === structure.room.memory.controllerContainer) {
				if (creep.room.creepsByRole.upgrader) return true;
				return false;
			}

			// Do not deliver to containers used as harvester drop off points.
			if (structure.room.sources) {
				for (const source of _.values(structure.room.sources)) {
					const container = source.getNearbyContainer();
					if (container && container.id === structure.id) {
						return false;
					}
				}

				if (structure.room.mineral) {
					const container = structure.room.mineral.getNearbyContainer();
					if (container && container.id === structure.id) {
						return false;
					}
				}
			}

			return true;
		},
	});

	for (const target of targets) {
		const option = {
			priority: 4,
			weight: (target.storeCapacity - target.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance, and other resources.
			type: 'structure',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		let prioFactor = 1;
		if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.5) {
			prioFactor = 2;
		}
		else if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.75) {
			prioFactor = 3;
		}

		option.priority -= creep.room.getCreepsWithOrder('deliver', target.id).length * prioFactor;

		options.push(option);
	}
};

/**
 * Adds options for filling towers with energy.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 */
Creep.prototype.addTowerDeliveryOptions = function (options) {
	const creep = this;
	const targets = creep.room.find(FIND_STRUCTURES, {
		filter: structure => {
			return (structure.structureType === STRUCTURE_TOWER) && structure.energy < structure.energyCapacity * 0.8;
		},
	});

	for (const target of targets) {
		const option = {
			priority: 3,
			weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
			type: 'structure',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		if (creep.room.memory.enemies && !creep.room.memory.enemies.safe) {
			option.priority++;
		}

		if (target.energy < target.energyCapacity * 0.2) {
			option.priority++;
		}

		option.priority -= creep.room.getCreepsWithOrder('deliver', target.id).length * 2;

		options.push(option);
	}
};

/**
 * Adds options for filling nukers and power spawns with energy.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 */
Creep.prototype.addHighLevelEnergyDeliveryOptions = function (options) {
	const creep = this;
	if (creep.room.isEvacuating()) return;
	if (creep.room.getCurrentResourceAmount(RESOURCE_ENERGY) < 100000) return;

	const targets = creep.room.find(FIND_STRUCTURES, {
		filter: structure => {
			return (structure.structureType === STRUCTURE_NUKER || structure.structureType === STRUCTURE_POWER_SPAWN) && structure.energy < structure.energyCapacity;
		},
	});

	for (const target of targets) {
		const option = {
			priority: 1,
			weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
			type: 'structure',
			object: target,
			resourceType: RESOURCE_ENERGY,
		};

		if (target.structureType === STRUCTURE_POWER_SPAWN) {
			option.priority += 2;
		}

		option.priority -= creep.room.getCreepsWithOrder('deliver', target.id).length * 2;

		options.push(option);
	}
};

/**
 * Adds options for storing energy.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 */
Creep.prototype.addStorageEnergyDeliveryOptions = function (options) {
	// Put in storage if nowhere else needs it.
	const storageTarget = this.room.getBestStorageTarget(this.carry.energy, RESOURCE_ENERGY);
	if (storageTarget) {
		options.push({
			priority: 0,
			weight: 0,
			type: 'structure',
			object: storageTarget,
			resourceType: RESOURCE_ENERGY,
		});
	}
	else {
		const storagePosition = this.room.getStorageLocation();
		if (storagePosition) {
			options.push({
				priority: 0,
				weight: 0,
				type: 'position',
				object: this.room.getPositionAt(storagePosition.x - 1, storagePosition.y),
				resourceType: RESOURCE_ENERGY,
			});
		}
	}
};

/**
 * Adds options for filling links with energy.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 */
Creep.prototype.addLinkDeliveryOptions = function (options) {
	const creep = this;
	// Deliver energy to storage links.
	if (!creep.room.linkNetwork || creep.room.linkNetwork.energy >= creep.room.linkNetwork.minEnergy) return;

	for (const link of creep.room.linkNetwork.neutralLinks) {
		if (link.energy < link.energyCapacity) {
			const option = {
				priority: 5,
				weight: (link.energyCapacity - link.energy) / 100, // @todo Also factor in distance.
				type: 'structure',
				object: link,
				resourceType: RESOURCE_ENERGY,
			};

			if (creep.pos.getRangeTo(link) > 10) {
				// Don't go out of your way to fill the link, do it when nearby, e.g. at storage.
				option.priority--;
			}

			options.push(option);
		}
	}
};

/**
 * Adds options for filling nukers and power spawns with resources.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 * @param {string} resourceType
 *   The type of resource to deliver.
 */
Creep.prototype.addHighLevelResourceDeliveryOptions = function (options, resourceType) {
	const creep = this;
	// Put ghodium in nukers.
	if (resourceType === RESOURCE_GHODIUM && !creep.room.isEvacuating()) {
		const targets = creep.room.find(FIND_STRUCTURES, {
			filter: structure => {
				return (structure.structureType === STRUCTURE_NUKER) && structure.ghodium < structure.ghodiumCapacity;
			},
		});

		for (const target of targets) {
			options.push({
				priority: 2,
				weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType,
			});
		}
	}

	// Put power in power spawns.
	if (resourceType === RESOURCE_POWER && creep.room.powerSpawn && !creep.room.isEvacuating()) {
		if (creep.room.powerSpawn.power < creep.room.powerSpawn.powerCapacity * 0.1) {
			options.push({
				priority: 4,
				weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
				type: 'structure',
				object: creep.room.powerSpawn,
				resourceType,
			});
		}
	}
};

/**
 * Adds options for filling labs with resources.
 *
 * @param {Array} options
 *   A list of potential delivery targets.
 * @param {string} resourceType
 *   The type of resource to deliver.
 */
Creep.prototype.addLabResourceDeliveryOptions = function (options, resourceType) {
	const creep = this;
	if (creep.room.memory.currentReaction && !creep.room.isEvacuating()) {
		if (resourceType === creep.room.memory.currentReaction[0]) {
			const lab = Game.getObjectById(creep.room.memory.labs.source1);
			if (lab && (!lab.mineralType || lab.mineralType === resourceType) && lab.mineralAmount < lab.mineralCapacity * 0.8) {
				options.push({
					priority: 4,
					weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: lab,
					resourceType,
				});
			}
		}

		if (resourceType === creep.room.memory.currentReaction[1]) {
			const lab = Game.getObjectById(creep.room.memory.labs.source2);
			if (lab && (!lab.mineralType || lab.mineralType === resourceType) && lab.mineralAmount < lab.mineralCapacity * 0.8) {
				options.push({
					priority: 4,
					weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: lab,
					resourceType,
				});
			}
		}
	}
};

/**
 * Sets a good energy delivery target for this creep.
 */
Creep.prototype.calculateDeliveryTarget = function () {
	const creep = this;
	const best = utilities.getBestOption(creep.getAvailableDeliveryTargets());

	if (best) {
		if (best.type === 'position') {
			creep.memory.deliverTarget = {x: best.object.x, y: best.object.y, type: best.type};

			creep.memory.order = {
				type: 'deliver',
				target: utilities.encodePosition(best.object),
				resourceType: best.resourceType,
			};
		}
		else if (best.type === 'bay') {
			creep.memory.deliverTarget = {x: best.object.pos.x, y: best.object.pos.y, type: best.type};

			creep.memory.order = {
				type: 'deliver',
				target: best.object.name,
				resourceType: best.resourceType,
			};
		}
		else if (best.type === 'drop') {
			creep.drop(best.resourceType, creep.carry[best.resourceType]);
		}
		else {
			creep.memory.deliverTarget = best.object.id;

			creep.memory.order = {
				type: 'deliver',
				target: best.object.id,
				resourceType: best.resourceType,
			};
		}
	}
	else {
		delete creep.memory.deliverTarget;
	}
};

/**
 * Makes this creep deliver carried energy somewhere.
 */
Creep.prototype.performDeliver = function () {
	const creep = this;

	if (!this.ensureValidDeliveryTarget()) {
		delete creep.memory.deliverTarget;
		return;
	}

	const best = creep.memory.deliverTarget;

	if (typeof best === 'string') {
		const target = Game.getObjectById(best);

		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
		}
		else {
			creep.transfer(target, creep.memory.order.resourceType);
		}

		return;
	}

	if (best.type === 'bay') {
		const target = _.find(creep.room.bays, bay => bay.flag.name === creep.memory.order.target);

		if (creep.pos.getRangeTo(target) > 0) {
			creep.moveToRange(target);
		}
		else {
			target.refillFrom(creep);
		}

		return;
	}

	if (best.x) {
		// Dropoff location.
		if (creep.pos.x === best.x && creep.pos.y === best.y) {
			creep.drop(creep.memory.order.resourceType);
		}
		else {
			const result = creep.moveTo(best.x, best.y);
			if (result === ERR_NO_PATH) {
				if (!creep.memory.blockedPathCounter) {
					creep.memory.blockedPathCounter = 0;
				}

				creep.memory.blockedPathCounter++;

				if (creep.memory.blockedPathCounter > 10) {
					creep.calculateDeliveryTarget();
				}
			}
			else {
				delete creep.memory.blockedPathCounter;
			}
		}

		return;
	}

	// Unknown target type, reset!
	hivemind.log('default').error('Unknown target type for delivery found!', JSON.stringify(creep.memory.deliverTarget));
	delete creep.memory.deliverTarget;
};

/**
 * Makes sure the creep has a valid target for resource delivery.
 *
 * @return {boolean}
 *   True if the target is valid and can receive the needed resource.
 */
Creep.prototype.ensureValidDeliveryTarget = function () {
	const creep = this;

	if (!creep.memory.deliverTarget) creep.calculateDeliveryTarget();

	const resourceType = creep.memory.order && creep.memory.order.resourceType;
	if ((creep.carry[resourceType] || 0) <= 0) return false;

	if (typeof creep.memory.deliverTarget === 'string') {
		return this.ensureValidDeliveryTargetObject(Game.getObjectById(creep.memory.deliverTarget), resourceType);
	}

	if (creep.memory.deliverTarget.type === 'bay') {
		const target = _.find(creep.room.bays, bay => bay.flag.name === creep.memory.order.target);
		if (!target) return false;

		if (target.energy < target.energyCapacity) return true;
	}
	else if (creep.memory.deliverTarget.x) {
		return true;
	}

	return false;
};

/**
 * Makes sure the creep has a valid target for resource delivery.
 *
 * @param {RoomObject} target
 *   The target to deliver resources to.
 * @param {string} resourceType
 *   The type of resource that is being delivered.
 *
 * @return {boolean}
 *   True if the target is valid and can receive the needed resource.
 */
Creep.prototype.ensureValidDeliveryTargetObject = function (target, resourceType) {
	if (!target) return false;
	if (this.memory.singleRoom && target.pos.roomName !== this.memory.singleRoom) return false;

	if (target.store && _.sum(target.store) < target.storeCapacity) return true;
	if (resourceType === RESOURCE_ENERGY && target.energyCapacity && target.energy < target.energyCapacity) return true;
	if (resourceType === RESOURCE_POWER && target.powerCapacity && target.power < target.powerCapacity) return true;
	if (target.mineralCapacity && ((target.mineralType || resourceType) === resourceType) && target.mineralAmount < target.mineralCapacity) return true;
};

/**
 * Puts this creep into or out of delivery mode.
 *
 * @param {boolean} delivering
 *   Whether this creep is delivering resources instead of collecting.
 */
Creep.prototype.setTransporterState = function (delivering) {
	this.memory.delivering = delivering;
	delete this.memory.sourceTarget;
	delete this.memory.order;
	delete this.memory.deliverTarget;
};

/**
 * Makes sure creeps don't get stuck in bays.
 *
 * @return {boolean}
 *   True if the creep is trying to get free.
 */
Creep.prototype.bayUnstuck = function () {
	// If the creep is in a bay, but not delivering to that bay (any more), make it move out of the bay forcibly.
	for (const bay of this.room.bays) {
		// @todo Number of extensions is not really the correct measure, number of
		// walkable tiles around center is.
		if (bay.extensions.length < 7) continue;

		if (this.pos.x !== bay.pos.x || this.pos.y !== bay.pos.y) continue;

		const best = this.memory.deliverTarget;

		// It's fine if we're explicitly delivering to this bay right now.
		if (best && typeof best !== 'string' && best.type === 'bay' && this.memory.order.target === bay.flag.name) continue;

		// We're standing in a bay that we're not delivering to.
		const terrain = new Room.Terrain(this.pos.roomName);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (dx === 0 && dy === 0) continue;

				if (terrain.get(this.pos.x + dx, this.pos.y + dy) === TERRAIN_MASK_WALL) continue;

				const pos = new RoomPosition(this.pos.x + dx, this.pos.y + dy, this.pos.roomName);

				// Check if there's a structure here already.
				const structures = pos.lookFor(LOOK_STRUCTURES);
				if (_.filter(structures, structure => _.contains(OBSTACLE_OBJECT_TYPES, structure.structureType)).length > 0) continue;

				// Check if there's a construction site here already.
				const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
				if (_.filter(sites, site => _.contains(OBSTACLE_OBJECT_TYPES, site.structureType)).length > 0) continue;

				const dir = this.pos.getDirectionTo(pos);
				this.move(dir);

				return true;
			}
		}
	}

	return false;
};

/**
 * Makes this creep behave like a transporter.
 */
Creep.prototype.runTransporterLogic = function () {
	if (this.memory.singleRoom) {
		if (this.pos.roomName !== this.memory.singleRoom) {
			this.moveToRange(new RoomPosition(25, 25, this.memory.singleRoom), 10);
			return;
		}

		if (this.memory.order && this.memory.order.target) {
			const target = Game.getObjectById(this.memory.order.target);
			if (target && target.pos && target.pos.roomName !== this.memory.singleRoom) {
				this.setTransporterState(this.memory.delivering);
			}
		}
	}

	if (_.sum(this.carry) >= this.carryCapacity * 0.9 && !this.memory.delivering) {
		this.setTransporterState(true);
	}
	else if (_.sum(this.carry) <= this.carryCapacity * 0.1 && this.memory.delivering) {
		this.setTransporterState(false);
	}

	if (this.bayUnstuck()) return;

	if (this.memory.delivering) {
		this.performDeliver();
		return;
	}

	// Make sure not to keep standing on resource drop stop.
	const storagePosition = this.room.getStorageLocation();
	if (!this.room.storage && storagePosition && this.pos.x === storagePosition.x && this.pos.y === storagePosition.y && (!this.memory.order || !this.memory.order.target)) {
		this.move(_.random(1, 8));
		return;
	}

	this.performGetResources();
};
