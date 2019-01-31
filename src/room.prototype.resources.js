'use strict';

/* global Room RoomPosition RESOURCE_ENERGY LOOK_RESOURCES RESOURCES_ALL
RESOURCE_POWER FIND_MY_CONSTRUCTION_SITES STRUCTURE_STORAGE FIND_STRUCTURES
STRUCTURE_SPAWN */

const utilities = require('./utilities');

Room.prototype.getStorageLimit = function () {
	let total = 0;
	if (this.storage) {
		total += this.storage.storeCapacity;
	}
	else {
		// Assume 10000 storage for dropping stuff on the ground.
		total += 10000;
	}

	if (this.terminal) {
		total += this.terminal.storeCapacity;
	}

	return total;
};

Room.prototype.getStorageCapacity = function () {
	// Determines amount of free space in storage.
	let limit = this.getStorageLimit();
	if (this.storage) {
		limit -= _.sum(this.storage.store);
	}

	if (this.terminal) {
		limit -= _.sum(this.terminal.store);
	}

	return limit;
};

Room.prototype.getCurrentResourceAmount = function (resourceType) {
	let total = 0;
	if (this.storage && this.storage.store[resourceType]) {
		total += this.storage.store[resourceType];
	}

	if (this.terminal && this.terminal.store[resourceType]) {
		total += this.terminal.store[resourceType];
	}

	return total;
};

Room.prototype.getStoredEnergy = function () {
	// @todo Add caching, make sure it's fresh every tick.
	let total = this.getCurrentResourceAmount(RESOURCE_ENERGY);

	const storageLocation = this.getStorageLocation();
	const storagePosition = new RoomPosition(storageLocation.x, storageLocation.y, this.name);
	const resources = _.filter(storagePosition.lookFor(LOOK_RESOURCES), resource => resource.resourceType === RESOURCE_ENERGY);
	if (resources.length > 0) {
		total += resources[0].amount;
	}

	return total;
};

Room.prototype.getCurrentMineralAmount = function () {
	// @todo This could use caching.
	let total = 0;

	for (const i in RESOURCES_ALL) {
		const resourceType = RESOURCES_ALL[i];
		if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
		total += this.getCurrentResourceAmount(resourceType);
	}

	return total;
};

Room.prototype.isFullOnEnergy = function () {
	return this.getCurrentResourceAmount(RESOURCE_ENERGY) > this.getStorageLimit() / 2;
};

Room.prototype.isFullOnPower = function () {
	return this.getCurrentResourceAmount(RESOURCE_POWER) > this.getStorageLimit() / 6;
};

Room.prototype.isFullOnMinerals = function () {
	return this.getCurrentMineralAmount() > this.getStorageLimit() / 3;
};

Room.prototype.isFullOn = function (resourceType) {
	if (resourceType === RESOURCE_ENERGY) return this.isFullOnEnergy();
	if (resourceType === RESOURCE_POWER) return this.isFullOnPower();
	return this.isFullOnMinerals();
};

/**
 * Calculates a central room position with some free space around it for placing a storage later.
 * If a storage already exists, its position is returned.
 */
Room.prototype.getStorageLocation = function () {
	const room = this;

	if (!this.controller) {
		return;
	}

	if (this.roomPlanner && this.roomPlanner.memory.locations && this.roomPlanner.memory.locations.center) {
		for (const pos in this.roomPlanner.memory.locations.center) {
			return utilities.decodePosition(pos);
		}
	}

	if (!room.memory.storage) {
		if (room.storage) {
			room.memory.storage = {
				x: room.storage.pos.x,
				y: room.storage.pos.y,
			};
		}
		else {
			const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
				filter: site => site.structureType === STRUCTURE_STORAGE,
			});
			if (sites && sites.length > 0) {
				room.memory.storage = {
					x: sites[0].pos.x,
					y: sites[0].pos.y,
				};
			}
			else {
				// Determine decent storage spot by averaging source and spawner locations.
				let count = 1;
				let x = room.controller.pos.x;
				let y = room.controller.pos.y;

				for (const i in room.sources) {
					x += room.sources[i].pos.x;
					y += room.sources[i].pos.y;
					count++;
				}

				const spawns = room.find(FIND_STRUCTURES, {
					filter: structure => structure.structureType === STRUCTURE_SPAWN,
				});
				for (const spawn of spawns) {
					x += spawn.pos.x;
					y += spawn.pos.y;
					count++;
				}

				x = Math.round(x / count);
				y = Math.round(y / count);

				// Now that we have a base position, try to find the
				// closest spot that is surrounded by empty tiles.
				let dist = 0;
				let found = false;
				while (!found && dist < 10) {
					for (let tx = x - dist; tx <= x + dist; tx++) {
						for (let ty = y - dist; ty <= y + dist; ty++) {
							if (found) {
								continue;
							}

							if (tx === x - dist || tx === x + dist || ty === y - dist || ty === y + dist) {
								// Tile is only valid if it and all surrounding tiles are empty.
								const contents = room.lookAtArea(ty - 1, tx - 1, ty + 1, tx + 1, true);
								let clean = true;
								for (const i in contents) {
									const tile = contents[i];
									if (tile.type === 'terrain' && tile.terrain !== 'plain' && tile.terrain !== 'swamp') {
										clean = false;
										break;
									}
									if (tile.type === 'structure' || tile.type === 'constructionSite') {
										clean = false;
										break;
									}
								}

								if (clean) {
									found = true;
									room.memory.storage = {
										x: tx,
										y: ty,
									};
								}
							}
						}
					}

					// @todo Limit dist and find "worse" free spot otherwise.
					dist++;
				}
			}
		}
	}

	return room.memory.storage;
};

Room.prototype.prepareForTrading = function (resourceType, amount) {
	if (!amount) amount = 10000;
	this.memory.fillTerminal = resourceType;
	this.memory.fillTerminalAmount = Math.min(amount, 50000);
};

Room.prototype.stopTradePreparation = function () {
	delete this.memory.fillTerminal;
	delete this.memory.fillTerminalAmount;
};

/**
 * Gets a list of remote mining targets designated for this room.
 */
Room.prototype.getRemoteHarvestTargets = function () {
	// @todo Cache this if we use it during spawning.

	if (!Memory.strategy) return [];
	const memory = Memory.strategy;

	const targets = {};

	for (const i in memory.roomList) {
		const info = memory.roomList[i];

		if (info.origin !== this.name) continue;
		if (!info.harvestActive) continue;

		targets[info.roomName] = info;
	}

	return targets;
};

/**
 * Gathers resource amounts for a room.
 */
Room.prototype.getResourceState = function () {
	if (!this.controller || !this.controller.my) return;

	const storage = this.storage;
	const terminal = this.terminal;

	const roomData = {
		totalResources: {},
		state: {},
		canTrade: false,
	};
	if (storage && terminal) {
		roomData.canTrade = true;
	}

	// @todo Remove in favor of function.
	roomData.isEvacuating = this.isEvacuating();

	if (storage && !roomData.isEvacuating) {
		for (const resourceType in storage.store) {
			roomData.totalResources[resourceType] = storage.store[resourceType];
		}
	}

	if (terminal) {
		for (const resourceType in terminal.store) {
			roomData.totalResources[resourceType] = (roomData.totalResources[resourceType] || 0) + terminal.store[resourceType];
		}
	}

	if (this.mineral && !roomData.isEvacuating) {
		// @todo Only count if there is an extractor on this mineral.
		roomData.mineralType = this.mineral.mineralType;
	}

	// Add resources in labs as well.
	if (this.memory.labs && !roomData.isEvacuating) {
		const ids = [];
		if (this.memory.labs.source1) {
			ids.push(this.memory.labs.source1);
		}

		if (this.memory.labs.source2) {
			ids.push(this.memory.labs.source2);
		}

		if (this.memory.labs.reactor) {
			for (const i in this.memory.labs.reactor) {
				ids.push(this.memory.labs.reactor[i]);
			}
		}

		for (const i in ids) {
			const lab = Game.getObjectById(ids[i]);
			if (lab && lab.mineralType && lab.mineralAmount > 0) {
				roomData.totalResources[lab.mineralType] = (roomData.totalResources[lab.mineralType] || 0) + lab.mineralAmount;
			}
		}
	}

	for (const resourceType in roomData.totalResources) {
		let amount = roomData.totalResources[resourceType];
		if (resourceType === RESOURCE_ENERGY) {
			amount /= 2.5;
		}

		if (amount >= 220000) {
			roomData.state[resourceType] = 'excessive';
		}
		else if (amount >= 30000) {
			roomData.state[resourceType] = 'high';
		}
		else if (amount >= 10000) {
			roomData.state[resourceType] = 'medium';
		}
		else {
			roomData.state[resourceType] = 'low';
		}
	}

	return roomData;
};
