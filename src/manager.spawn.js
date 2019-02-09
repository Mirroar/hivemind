'use strict';

/* global hivemind StructureSpawn Room RoomPosition BODYPART_COST OK
FIND_MY_CONSTRUCTION_SITES CONTROLLER_DOWNGRADE CREEP_LIFE_TIME CREEP_SPAWN_TIME
MAX_CREEP_SIZE FIND_MINERALS FIND_STRUCTURES STRUCTURE_EXTRACTOR FIND_FLAGS
SOURCE_ENERGY_CAPACITY ENERGY_REGEN_TIME CARRY_CAPACITY
CONTROLLER_RESERVE_MAX CLAIM MOVE CARRY ATTACK HEAL
CONTROLLER_MAX_UPGRADE_PER_TICK */

const stats = require('./stats');
const utilities = require('./utilities');

const roleNameMap = {
	builder: 'B',
	'builder.exploit': 'BE',
	'builder.remote': 'BR',
	claimer: 'C',
	dismantler: 'D',
	brawler: 'F',
	guardian: 'FE',
	gift: ':) GIFT (: ',
	harvester: 'H',
	'harvester.exploit': 'HE',
	'harvester.minerals': 'HM',
	'harvester.remote': 'HR',
	'harvester.power': 'HP',
	repairer: 'R',
	scout: 'S',
	transporter: 'T',
	'hauler.exploit': 'TE',
	'hauler.power': 'TP',
	hauler: 'TR',
	upgrader: 'U',
};

// @todo Choose the best spawn for a creep (distance to target).

/**
 * Intelligently tries to create a creep.
 *
 * @param {pbject} options
 *   An object containing conditions for creating this creep:
 *   - body: An array of body part constants to create the creep from.
 *   - bodyWeights: Alternative to body, an array keyed by body part names,
 *     with values describing the percantage of the creep body that should
 *     consist of parts of this type.
 *   - memory: Memory to save on this creep on creation.
 *   - role: Role identifier of the creep, if not set on memory.
 *   - maxCost: Maximum amount of energy to spend on this creep.
 *   - maxParts: An array keyed by body part names containing the maximum
 *     amount of parts of that type to spawn the creep with.
 *
 * @return {string|boolean}
 *   The name of the creep if it could be spawned, false otherwise.
 */
StructureSpawn.prototype.createManagedCreep = function (options) {
	if (!options) {
		throw new Error('No options for creep spawning defined.');
	}

	if (this.spawning) return false;

	let enoughEnergy = true;
	const minCost = options.minCost || this.room.energyCapacityAvailable * 0.9;

	const energyAvailable = Math.min(this.room.energyAvailable, this.room.energyCapacityAvailable);
	if (energyAvailable < minCost) {
		enoughEnergy = false;
	}

	let maxCost = Math.max(minCost, energyAvailable);
	if (options.body) {
		// Use the actual cost of a creep with this body.
		let maxPartsCost = 0;
		for (const part of options.body) {
			maxPartsCost += BODYPART_COST[part];
		}

		maxCost = Math.min(maxCost, maxPartsCost);
	}
	else {
		if (!options.bodyWeights) {
			throw new Error('No body definition for creep found.');
		}

		// Creep might be requested with a maximum energy cost.
		if (options.maxCost) {
			maxCost = Math.min(maxCost, options.maxCost);
		}

		// Creep might be requested with a part limit.
		let maxPartsCost = 0;
		// With theoretically unlimited energy, check how expensive the creep can become with maxSize.
		const tempBody = utilities.generateCreepBody(options.bodyWeights, this.room.energyCapacityAvailable, options.maxParts);
		for (const part of tempBody) {
			maxPartsCost += BODYPART_COST[part];
		}

		maxCost = Math.min(maxCost, maxPartsCost);

		options.body = utilities.generateCreepBody(options.bodyWeights, maxCost, options.maxParts);
	}

	if (energyAvailable >= maxCost) {
		enoughEnergy = true;
	}

	if (!enoughEnergy || this.canCreateCreep(options.body) !== OK) {
		return false;
	}

	// Prepare creep memory.
	const memory = options.memory || {};

	if (!memory.role) {
		memory.role = options.role || 'unknown';
	}

	// Store creep's body definition in memory for easier access.
	memory.body = _.countBy(options.body);

	// Generate creep name.
	if (!Memory.creepCounter) {
		Memory.creepCounter = {};
	}

	if (!Memory.creepCounter[memory.role] || Memory.creepCounter[memory.role] >= 36 * 36) {
		Memory.creepCounter[memory.role] = 0;
	}

	const roleName = roleNameMap[memory.role] || memory.role;
	const newName = roleName + '_' + Memory.creepCounter[memory.role].toString(36);

	// Actually try to spawn this creep.
	const result = this.createCreep(options.body, newName, memory);

	if (result !== newName) return false;

	// Spawning successful.
	Memory.creepCounter[memory.role]++;
	hivemind.log('creeps', this.pos.roomName).info('Spawning new creep:', newName);

	// Also notify room's boost manager if necessary.
	if (options.boosts && this.room.boostManager) {
		this.room.boostManager.markForBoosting(newName, options.boosts);
	}

	// Store role of spawning creep for visualization.
	this.memory.spawnRole = memory.role;

	return result;
};

/**
 * WIP Replacement of manageSpawns using a priority queue and more caches.
 *
 * @return {boolean}
 *   True if a creep was spawned.
 */
Room.prototype.manageSpawnsPriority = function () {
	if (!this.controller || !this.controller.my) {
		return false;
	}

	this.spawnOptions = {};

	const roomSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === this.name);
	// If all spawns are busy, no need to calculate what could be spawned.
	let allSpawning = true;
	let activeSpawn;
	for (const i in roomSpawns) {
		if (!roomSpawns[i].isActive()) continue;
		if (!roomSpawns[i].spawning) {
			allSpawning = false;
			activeSpawn = roomSpawns[i];
		}

		// If spawning was just finished, scan the room again to assign creeps.
		if (roomSpawns[i].spawning) {
			roomSpawns[i].memory.wasSpawning = true;
			if (this.visual) {
				this.visual.text(roomSpawns[i].memory.spawnRole, roomSpawns[i].pos.x + 0.05, roomSpawns[i].pos.y + 0.05, {
					size: 0.5,
					color: 'black',
				});
				this.visual.text(roomSpawns[i].memory.spawnRole, roomSpawns[i].pos.x, roomSpawns[i].pos.y, {
					size: 0.5,
				});
			}

			continue;
		}
		else if (roomSpawns[i].memory.wasSpawning) {
			roomSpawns[i].memory.wasSpawning = false;
			this.scan();
		}
	}

	if (allSpawning) {
		return true;
	}

	// Prepare spawn queue.
	if (!this.memory.spawnQueue) {
		this.memory.spawnQueue = {};
	}

	const memory = this.memory.spawnQueue;
	memory.options = [];

	// Fill spawn queue.
	this.addHarvesterSpawnOptions();
	this.addTransporterSpawnOptions();
	this.addUpgraderSpawnOptions();
	this.addBuilderSpawnOptions();
	this.addExploitSpawnOptions();
	this.addDismantlerSpawnOptions();
	this.addBoostManagerSpawnOptions();
	this.addPowerSpawnOptions();
	this.addGiftSpawnOptions();

	// In low level rooms, add defenses!
	if (this.memory.enemies && !this.memory.enemies.safe && this.controller.level < 4 && _.size(this.creepsByRole.brawler) < 2) {
		memory.options.push({
			priority: 5,
			weight: 1,
			role: 'brawler',
		});
	}

	if (memory.options.length > 0) {
		// Try to spawn the most needed creep.
		this.spawnCreepByPriority(activeSpawn);
		return true;
	}

	return false;
};

/**
 * Spawns the most needed creep from the priority queue.
 *
 * @param {StructureSpawn} activeSpawn
 *   A spawn that is not currently spawning a creep.
 */
Room.prototype.spawnCreepByPriority = function (activeSpawn) {
	const memory = this.memory.spawnQueue;
	const best = utilities.getBestOption(memory.options);

	if (best.role === 'harvester') {
		activeSpawn.spawnHarvester(best.force, best.maxWorkParts, best.source);
	}
	else if (best.role === 'transporter') {
		activeSpawn.spawnTransporter(best.force, best.size);
	}
	else if (best.role === 'upgrader') {
		activeSpawn.spawnUpgrader();
	}
	else if (best.role === 'gift') {
		activeSpawn.spawnGift();
	}
	else if (best.role === 'builder') {
		activeSpawn.spawnBuilder(best.size);
	}
	else if (best.role === 'dismantler') {
		activeSpawn.spawnDismantler(best.targetRoom);
	}
	else if (best.role === 'brawler') {
		activeSpawn.spawnBrawler(this.controller.pos);
	}
	else if (best.role === 'harvester.power') {
		activeSpawn.spawnPowerHarvester(best.targetRoom, best.isHealer);
	}
	else if (best.role === 'hauler.power') {
		activeSpawn.spawnPowerHauler(best.targetRoom);
	}
	else if (best.role === 'exploit') {
		Game.exploits[best.exploit].spawnUnit(activeSpawn, best);
	}
	else if (best.role === 'boosts') {
		Game.rooms[best.roomName].boostManager.spawn(activeSpawn);
	}
	else {
		hivemind.log('creeps', this.name).error('trying to spawn unknown creep role:', best.role);
	}
};

/**
 * Checks which sources in this room still need harvesters and adds those to queue.
 */
Room.prototype.addHarvesterSpawnOptions = function () {
	const memory = this.memory.spawnQueue;

	// If we have no other way to recover, spawn with reduced amounts of parts.
	let force = false;
	if (_.size(this.creepsByRole.harvester) === 0 && (!this.storage || (_.size(this.creepsByRole.transporter) === 0 && this.getStoredEnergy() < 5000))) {
		force = true;
	}

	if (!force && this.isFullOnEnergy()) return;

	for (const source of this.sources) {
		const maxParts = source.getMaxWorkParts();
		// Make sure at least one harvester is spawned for each source.
		if (source.harvesters.length === 0) {
			memory.options.push({
				priority: (force ? 5 : 4),
				weight: 1,
				role: 'harvester',
				source: source.id,
				maxWorkParts: maxParts,
				force,
			});
		}
		else if (this.controller.level <= 3 && source.harvesters.length < source.getNumHarvestSpots()) {
			// If there's still space at this source, spawn additional harvesters until the maximum number of work parts has been reached.
			// Starting from RCL 4, 1 harvester per source should always be enough.
			let totalWorkParts = 0;
			for (const creep of source.harvesters) {
				totalWorkParts += creep.memory.body.work || 0;
			}

			for (const creep of _.values(this.creepsByRole['builder.remote']) || {}) {
				totalWorkParts += (creep.memory.body.work || 0) / 2;
			}

			if (totalWorkParts < maxParts) {
				memory.options.push({
					priority: 4,
					weight: 1 - (totalWorkParts / maxParts),
					role: 'harvester',
					source: source.id,
					maxWorkParts: maxParts - totalWorkParts,
					force: false,
				});
			}
		}
	}
};

/**
 * Checks for and spawns more transporters.
 */
Room.prototype.addTransporterSpawnOptions = function () {
	const memory = this.memory.spawnQueue;

	const numSources = _.size(this.sources);
	const numTransporters = _.size(this.creepsByRole.transporter);
	let maxTransporters = 2 + (2 * numSources); // @todo Find a good way to gauge needed number of transporters by measuring distances.

	for (const i in this.sources) {
		// If we have a link to beam energy around, we'll need less transporters.
		if (this.sources[i].getNearbyLink() && this.memory.controllerLink) {
			maxTransporters--;
		}
	}

	// Need less transporters if energy gets beamed around the place a lot.
	if (this.memory.controllerLink && this.memory.storageLink) {
		maxTransporters--;
	}

	if (this.controller.level === 6) {
		// RCL 6 is that annoying level at which refilling extensions is very tedious and there are many things that need spawning.
		maxTransporters++;
	}

	// Need less transporters in rooms where remote builders are working.
	maxTransporters -= _.size(this.creepsByRole['builder.remote']);

	// On low level rooms, do not use (too many) transporters.
	if (this.controller.level < 3) {
		maxTransporters = 1;
	}

	if (this.controller.level < 4 || !this.storage) {
		// Storage mostly takes place in containers, units will get their energy from there.
		maxTransporters = 2;
	}

	// On higher level rooms, spawn less, but bigger, transporters.
	let sizeFactor = 1;
	if (this.controller.level >= 7) {
		sizeFactor = 2;
	}
	else if (this.controller.level >= 6) {
		sizeFactor = 1.5;
	}
	else if (this.controller.level >= 5) {
		sizeFactor = 1.25;
	}

	sizeFactor *= 1.5;
	maxTransporters /= 1.2;

	maxTransporters /= sizeFactor;
	maxTransporters = Math.max(maxTransporters, 2);

	if (this.isClearingTerminal() && this.terminal && _.sum(this.terminal.store) > this.terminal.storeCapacity * 0.01) {
		maxTransporters *= 1.5;
	}

	if (numTransporters < maxTransporters) {
		const option = {
			priority: 5,
			weight: 0.5,
			role: 'transporter',
			force: false,
			size: 8 * sizeFactor,
		};

		if (numTransporters >= maxTransporters / 2) {
			option.priority = 4;
		}
		else if (numTransporters > 1) {
			option.weight = 0;
		}
		else {
			option.force = true;
		}

		memory.options.push(option);
	}
};

/**
 * Spawns a number of upgraders appropriate for this room.
 */
Room.prototype.addUpgraderSpawnOptions = function () {
	const memory = this.memory.spawnQueue;

	const numUpgraders = _.size(_.filter(this.creepsByRole.upgrader, creep => !creep.ticksToLive || creep.ticksToLive > creep.body.length * 3));
	let maxUpgraders = 0;

	if (this.controller.level <= 3) {
		const numSources = _.size(this.sources);
		maxUpgraders = 1 + numSources + Math.floor(this.getStoredEnergy() / 2000);
		maxUpgraders = Math.min(maxUpgraders, 5);
	}
	else if (this.controller.level === 8) {
		maxUpgraders = 1;
		if (this.getStoredEnergy() < 50000) {
			maxUpgraders = 0;
		}
	}
	else if (this.getStoredEnergy() < 100000) {
		maxUpgraders = 0;
	}
	else if (this.getStoredEnergy() < 300000) {
		maxUpgraders = 1;
	}
	else if (this.getStoredEnergy() < 500000) {
		maxUpgraders = 2;
	}
	else {
		// @todo Have maximum depend on number of work parts.
		// @todo Make sure enough energy is brought by.
		maxUpgraders = 3;
	}

	if (this.isEvacuating()) maxUpgraders = 0;

	if (!this.storage && !this.terminal && this.find(FIND_MY_CONSTRUCTION_SITES).length > 0) {
		// Do not spawn upgraders when builders and spawns will need most of
		// our energy.
		maxUpgraders = 0;
	}

	if (maxUpgraders === 0 && this.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[this.controller.level] * 0.5) {
		hivemind.log('creeps', this.name).info('trying to spawn upgrader because controller is close to downgrading', this.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[this.controller.level]);
		// Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
		maxUpgraders = 1;
	}

	if (numUpgraders < maxUpgraders) {
		memory.options.push({
			priority: 3,
			weight: 1,
			role: 'upgrader',
		});
	}
};

/**
 * Spawns a number of repairers to keep buildings in good health.
 */
Room.prototype.addBuilderSpawnOptions = function () {
	const memory = this.memory.spawnQueue;

	let numWorkParts = 0;
	let maxWorkParts = 5;
	let builderSize = null;
	if (this.controller.level > 2) {
		maxWorkParts += 5;
	}

	_.each(this.creepsByRole.repairer, creep => {
		numWorkParts += creep.memory.body.work || 0;
	});
	_.each(this.creepsByRole.builder, creep => {
		numWorkParts += creep.memory.body.work || 0;
	});

	// There are a lot of ramparts in planned rooms, spawn builders appropriately.
	if (this.roomPlanner && this.roomPlanner.memory.locations && this.controller && this.controller.my && this.controller.level >= 4) {
		maxWorkParts += _.size(this.roomPlanner.memory.locations.rampart || []) / 10;
	}

	// Add more repairers if we have a lot of energy to spare.
	if (this.storage && this.storage.store.energy > 400000) {
		maxWorkParts *= 2;
	}
	else if (this.storage && this.storage.store.energy > 200000) {
		maxWorkParts *= 1.5;
	}

	// Add more builders if we're moving a spawn.
	if (this.memory.roomPlanner && this.memory.roomPlanner.hasMisplacedSpawn) {
		maxWorkParts *= 1.5;
	}

	if (this.controller.level <= 3) {
		if (this.find(FIND_MY_CONSTRUCTION_SITES).length === 0) {
			// There isn't really much to repair before RCL 4, so don't spawn
			// new builders when there's nothing to build.
			maxWorkParts = 0;
		}
	}
	else {
		// Spawn more builders depending on total size of current construction sites.
		// @todo Use hitpoints of construction sites vs number of work parts as a guide.
		maxWorkParts += this.find(FIND_MY_CONSTRUCTION_SITES).length / 2;
	}

	if (this.isEvacuating()) {
		// Just spawn a small builder for keeping roads intact.
		maxWorkParts = 1;
		builderSize = 3;
	}

	if (numWorkParts < maxWorkParts) {
		memory.options.push({
			priority: 3,
			weight: 0.5,
			role: 'builder',
			size: builderSize,
		});
	}
};

/**
 * Adds creeps that need to be spawned for exploits to spawn queue.
 */
Room.prototype.addExploitSpawnOptions = function () {
	if (_.size(this.exploits) === 0) return;

	const memory = this.memory.spawnQueue;
	_.each(this.exploits, exploit => exploit.addSpawnOptions(memory.options));
};

/**
 * Adds helper creeps the boost manager might need to spawn queue.
 */
Room.prototype.addBoostManagerSpawnOptions = function () {
	if (!this.boostManager) return;

	const memory = this.memory.spawnQueue;
	if (this.boostManager.needsSpawning()) {
		memory.options.push({
			priority: 4,
			weight: 1,
			role: 'boosts',
			roomName: this.name,
		});
	}
};

Room.prototype.addPowerSpawnOptions = function () {
	if (Memory.disablePowerHarvesting) {
		return;
	}

	if (!Memory.strategy || !Memory.strategy.power || !Memory.strategy.power.rooms) {
		return;
	}

	const memory = this.memory.spawnQueue;
	const myRoomName = this.name;

	_.each(Memory.strategy.power.rooms, (info, roomName) => {
		if (!info.isActive) return;

		// @todo Determine supposed time until we crack open the power bank.
		// Then we can stop spawning attackers and spawn haulers instead.

		if (info.spawnRooms[myRoomName]) {
			const travelTime = 50 * info.spawnRooms[myRoomName].distance;

			const timeToKill = info.hits / info.dps;

			// We're assigned to spawn creeps for this power gathering operation!
			const powerHarvesters = _.filter(Game.creepsByRole['harvester.power'] || [], creep => {
				if (creep.memory.sourceRoom === myRoomName && creep.memory.targetRoom === roomName && !creep.memory.isHealer) {
					if ((creep.ticksToLive || CREEP_LIFE_TIME) >= (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) {
						return true;
					}
				}

				return false;
			});
			const powerHealers = _.filter(Game.creepsByRole['harvester.power'] || [], creep => {
				if (creep.memory.sourceRoom === myRoomName && creep.memory.targetRoom === roomName && creep.memory.isHealer) {
					if ((creep.ticksToLive || CREEP_LIFE_TIME) >= (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) {
						return true;
					}
				}

				return false;
			});

			if (powerHarvesters.length < 2 && powerHarvesters.length <= powerHealers.length && timeToKill > 0) {
				memory.options.push({
					priority: 4,
					weight: 1,
					role: 'harvester.power',
					targetRoom: roomName,
				});
			}

			// Also spawn healers.
			if (powerHealers.length < 2 && powerHarvesters.length >= powerHealers.length && timeToKill > 0) {
				memory.options.push({
					priority: 4,
					weight: 1,
					role: 'harvester.power',
					targetRoom: roomName,
					isHealer: true,
				});
			}

			if (timeToKill < (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + (CREEP_LIFE_TIME / 3)) {
				// Time to spawn haulers!
				const powerHaulers = _.filter(Game.creepsByRole['hauler.power'] || {}, creep => creep.memory.targetRoom === roomName);
				let totalCapacity = 0;
				_.each(powerHaulers, creep => {
					totalCapacity += creep.carryCapacity;
				});

				if (totalCapacity < info.amount * 1.2) {
					memory.options.push({
						priority: 4,
						weight: 0.5,
						role: 'hauler.power',
						targetRoom: roomName,
					});
				}
			}
		}
	});
};

Room.prototype.addGiftSpawnOptions = function () {
	if (Game.time % 123 !== 67) return;
	if (!this.storage || this.getStorageCapacity() > this.getStorageLimit() * 0.05) return;

	const memory = this.memory.spawnQueue;
	memory.options.push({
		priority: 4,
		weight: 0,
		role: 'gift',
	});
};

Room.prototype.addDismantlerSpawnOptions = function () {
	if (this.isEvacuating()) return;

	const memory = this.memory.spawnQueue;

	const flags = _.filter(Game.flags, flag => flag.name.startsWith('Dismantle:' + this.name));
	if (flags.length > 0) {
		// @todo Check if there is enough dismantlers per room with flags in it.
		const flag = flags[0];
		const numDismantlers = _.filter(Game.creepsByRole.dismantler || [], creep => creep.memory.targetRoom === flag.pos.roomName && creep.memory.sourceRoom === this.name).length;

		if (numDismantlers < flags.length) {
			memory.options.push({
				priority: 4,
				weight: 0,
				role: 'dismantler',
				targetRoom: flag.pos.roomName,
			});
		}
	}

	if (this.roomPlanner && this.roomPlanner.needsDismantling()) {
		// @todo this.roomPlanner will not be available until spawn management is moved to run after room logic.
		const numDismantlers = _.filter(this.creepsByRole.dismantler || [], creep => creep.memory.targetRoom === this.name && creep.memory.sourceRoom === this.name).length;

		if (numDismantlers < 1) {
			memory.options.push({
				priority: 3,
				weight: 0,
				role: 'dismantler',
				targetRoom: this.name,
			});
		}
	}
};

/**
 * Spawns creeps in a room whenever needed.
 */
Room.prototype.manageSpawns = function () {
	if (!this.memory.throttleOffset) this.memory.throttleOffset = utilities.getThrottleOffset();
	if (utilities.throttle(this.memory.throttleOffset, 0, Memory.throttleInfo.bucket.warning)) return;

	// If the new spawn code is trying to spawn something, give it priority.
	if (this.manageSpawnsPriority()) return;

	const roomSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === this.name && spawn.isActive());
	const room = this;

	let spawnerUsed = false;
	for (const spawn of _.values(roomSpawns)) {
		if (spawnerUsed) break;

		// @todo Stop spawning for a bit if creeps are queued for renewing.

		// If spawning was just finished, scan the room again to assign creeps.
		if (spawn.spawning) {
			spawn.memory.wasSpawning = true;
			continue;
		}

		if (spawn.memory.wasSpawning) {
			spawn.memory.wasSpawning = false;
			room.scan();
		}

		spawnerUsed = true;

		// Harvest minerals.
		if (spawn.spawnMineralHarvester()) return true;

		// Spawn squads.
		if (spawn.spawnSquadUnits()) return true;

		// We've got nothing to do, how about some remote harvesting?
		const harvestPositions = [];
		const remoteHarvestTargets = spawn.room.getRemoteHarvestTargets();
		for (const i in remoteHarvestTargets) {
			const roomName = remoteHarvestTargets[i].roomName;
			const sources = hivemind.roomIntel(roomName).getSourcePositions();
			for (const j in sources) {
				harvestPositions.push(new RoomPosition(sources[j].x, sources[j].y, roomName));
			}
		}

		for (const i in harvestPositions) {
			const pos = harvestPositions[i];

			// First of all, if it's not safe, send a bruiser.
			const roomMemory = Memory.rooms[pos.roomName];
			if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) {
				let position = spawn.pos;
				if (spawn.room.storage) {
					position = spawn.room.storage.pos;
				}

				// Since we just want a brawler in the room - not one per remoteharvest source - generalize target position.
				const brawlPosition = new RoomPosition(25, 25, pos.roomName);

				const maxBrawlers = 1;
				const brawlers = _.filter(Game.creepsByRole.brawler || [], creep => {
					if (creep.memory.storage === utilities.encodePosition(position) && creep.memory.target === utilities.encodePosition(brawlPosition)) {
						return true;
					}

					return false;
				});

				if (!brawlers || brawlers.length < maxBrawlers) {
					const result = spawn.spawnBrawler(brawlPosition, 4, utilities.encodePosition(pos));
					if (result) {
						const position = utilities.encodePosition(pos);
						console.log('Spawning new brawler to defend', position, ':', result);

						let cost = 0;
						for (const partType in Memory.creeps[result].body) {
							cost += BODYPART_COST[partType] * Memory.creeps[result].body[partType];
						}

						stats.addRemoteHarvestDefenseCost(spawn.room.name, position, cost);
					}

					// Do not continue trying to spawn other creeps when defense is needed.
					return true;
				}
			}

			// If it's safe or brawler is sent, start harvesting.
			let doSpawn = true;
			const flagPosition = utilities.encodePosition(pos);
			let position = spawn.pos;
			if (spawn.room.storage) {
				position = spawn.room.storage.pos;
			}

			position = utilities.encodePosition(position);

			// Cache path when possible.
			try {
				utilities.precalculatePaths(spawn.room, pos);
			}
			catch (error) {
				console.log('Error in pathfinding:', error);
				console.log(error.stack);
			}

			if (spawn.room.memory.remoteHarvesting && spawn.room.memory.remoteHarvesting[flagPosition]) {
				const memory = spawn.room.memory.remoteHarvesting[flagPosition];
				doSpawn = false;

				memory.harvesters = [];
				let haulCount = 0;
				const harvesters = _.filter(Game.creepsByRole['harvester.remote'] || [], creep => creep.memory.storage === position && creep.memory.source === flagPosition);
				const haulers = _.filter(Game.creepsByRole.hauler || [], creep => creep.memory.storage === position && creep.memory.source === flagPosition);

				const maxRemoteHarvesters = 1;
				let maxRemoteHaulers = 0;
				if (memory.revenue > 0 || memory.hasContainer) {
					// @todo Calculate number of needed haulers.
					maxRemoteHaulers = 1;

					if (Game.rooms[pos.roomName]) {
						const room = Game.rooms[pos.roomName];
						if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username == utilities.getUsername()))) {
							maxRemoteHaulers = 2;
						}
					}
				}

				let maxCarryParts;
				let travelTime;
				let travelTimeSpawn;
				if (memory.travelTime) {
					travelTime = memory.travelTime;
					travelTimeSpawn = memory.travelTime;
				}

				if (memory.cachedPath && memory.cachedPath.path) {
					// Path length is more accurate than observed travel time, because it's calculated between storage and source, not spawn and source.
					travelTime = memory.cachedPath.path.length;

					if (!travelTimeSpawn) {
						travelTimeSpawn = memory.cachedPath.path.length;
					}
				}

				if (travelTime) {
					maxCarryParts = Math.ceil(travelTime * SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / CARRY_CAPACITY);

					// If we cannot create big enough haulers (yet), create more of them!
					const bodyWeights = spawn.getHaulerBodyWeights();
					const maxHauler = utilities.generateCreepBody(bodyWeights, spawn.room.energyCapacityAvailable, {carry: maxCarryParts});
					let carryCount = 0;
					for (const j in maxHauler) {
						if (maxHauler[j] === CARRY) {
							carryCount++;
						}
					}

					const multiplier = Math.min(maxCarryParts / carryCount, 3);
					maxRemoteHaulers *= multiplier;
				}

				for (const j in harvesters) {
					const creep = harvesters[j];
					if (!travelTimeSpawn || creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500 || creep.spawning) {
						memory.harvesters.push(creep.id);
					}
				}

				if (memory.harvesters.length < maxRemoteHarvesters) {
					doSpawn = true;
				}

				for (const j in haulers) {
					const creep = haulers[j];
					if (!travelTimeSpawn || creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500 || creep.spawning) {
						haulCount++;
					}
				}

				if (haulCount < maxRemoteHaulers && !doSpawn) {
					// Spawn hauler if necessary, but not if harvester is needed first.
					const result = spawn.spawnHauler(pos, maxCarryParts);
					if (result) {
						let cost = 0;
						for (const part in Memory.creeps[result].body) {
							const count = Memory.creeps[result].body[part];
							cost += BODYPART_COST[part] * count;
						}

						stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(pos), cost);
						return true;
					}
				}
			}

			if (doSpawn) {
				const result = spawn.spawnRemoteHarvester(pos);
				if (result) {
					let cost = 0;
					for (const part in Memory.creeps[result].body) {
						const count = Memory.creeps[result].body[part];
						cost += BODYPART_COST[part] * count;
					}

					stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(pos), cost);
					return true;
				}
			}
		}

		// No harvester spawned? How about some claimers?
		// @todo Move from flags to positions for automation.
		const reservePositions = [];
		const reserveFlags = _.filter(Game.flags, flag => flag.name.startsWith('ReserveRoom'));
		for (const i in reserveFlags) {
			const flag = reserveFlags[i];
			let isSpecificFlag = false;

			// Make sure not to harvest from wrong rooms.
			if (flag.name.startsWith('ReserveRoom:')) {
				const parts = flag.name.split(':');
				if (parts[1] && parts[1] !== spawn.pos.roomName) {
					continue;
				}

				isSpecificFlag = true;
			}

			if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) > 1 && !isSpecificFlag) {
				continue;
			}

			reservePositions.push(flag.pos);
		}

		for (const i in remoteHarvestTargets) {
			const position = hivemind.roomIntel(remoteHarvestTargets[i].roomName).getControllerPosition();
			if (position) {
				reservePositions.push(position);
			}
		}

		const safeRooms = this.roomPlanner ? this.roomPlanner.getAdjacentSafeRooms() : [];
		for (const i in safeRooms) {
			const position = hivemind.roomIntel(safeRooms[i]).getControllerPosition();
			if (position) {
				reservePositions.push(position);
			}
		}

		for (const i in reservePositions) {
			const pos = reservePositions[i];

			// Cache path when possible.
			try {
				utilities.precalculatePaths(spawn.room, pos);
			}
			catch (error) {
				console.log('Error in pathfinding:', error);
				console.log(error.stack);
			}

			let doSpawn = false;

			const claimerIds = [];
			const claimers = _.filter(Game.creepsByRole.claimer || [], creep => creep.memory.mission === 'reserve');
			const maxClaimers = 1;

			for (const j in claimers) {
				const creep = claimers[j];

				if (creep.memory.target === utilities.encodePosition(pos)) {
					claimerIds.push(creep.id);
				}
			}

			if (claimerIds.length < maxClaimers) {
				doSpawn = true;
			}

			if (Memory.rooms[pos.roomName] &&
				Memory.rooms[pos.roomName].lastClaim &&
				Memory.rooms[pos.roomName].lastClaim.value + (Memory.rooms[pos.roomName].lastClaim.time - Game.time) > CONTROLLER_RESERVE_MAX * 0.5
			) {
				doSpawn = false;
			}

			if (doSpawn) {
				const result = spawn.spawnClaimer(pos, 'reserve');

				if (result) {
					// Add cost to a random harvest flag in the room.
					// @todo Now that we don't always use flags, find a better way to associate.
					const harvestFlags = _.filter(Game.flags, flag2 => {
						if (flag2.name.startsWith('HarvestRemote') && flag2.pos.roomName === pos.roomName) {
							// Make sure not to harvest from wrong rooms.
							if (flag2.name.startsWith('HarvestRemote:')) {
								const parts = flag2.name.split(':');
								if (parts[1] && parts[1] !== spawn.pos.roomName) {
									return false;
								}
							}

							return true;
						}

						return false;
					});

					if (harvestFlags.length > 0) {
						let cost = 0;
						for (const part in Memory.creeps[result].body) {
							const count = Memory.creeps[result].body[part];
							cost += BODYPART_COST[part] * count;
						}

						stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(_.sample(harvestFlags).pos), cost);
					}

					return true;
				}
			}
		}

		// Last but not least: Scouts.
		let found = false;
		for (const i in Game.creepsByRole.scout || []) {
			if (Game.creepsByRole.scout[i].memory.origin === spawn.pos.roomName) {
				found = true;
				break;
			}
		}

		if (!found && spawn.room.needsScout()) {
			if (spawn.spawnScout()) {
				return true;
			}
		}

		// Let only one spawner start spawning each tick to prevent confusion.
		break;
	}
};

StructureSpawn.prototype.spawnRemoteHarvester = function (targetPosition) {
	let bodyWeights = {move: 0.5, work: 0.2, carry: 0.3};
	const maxParts = {work: 3};
	// Use less work parts if room is not reserved yet.
	if (Game.rooms[targetPosition.roomName]) {
		const room = Game.rooms[targetPosition.roomName];
		if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username === utilities.getUsername()))) {
			maxParts.work = 6;
		}
	}
	// @todo Also use high number of work parts if road still needs to be built.

	// Use less move parts if a road has already been established.
	if (this.room.memory.remoteHarvesting && this.room.memory.remoteHarvesting[utilities.encodePosition(targetPosition)] && this.room.memory.remoteHarvesting[utilities.encodePosition(targetPosition)].revenue > 0) {
		// @todo Use calculated max size like normal harvesters.
		bodyWeights = {move: 0.35, work: 0.55, carry: 0.1};
	}

	let position = this.pos;
	if (this.room.storage) {
		position = this.room.storage.pos;
	}

	return this.createManagedCreep({
		role: 'harvester.remote',
		bodyWeights,
		maxParts,
		memory: {
			storage: utilities.encodePosition(position),
			source: utilities.encodePosition(targetPosition),
		},
	});
};

StructureSpawn.prototype.spawnBrawler = function (targetPosition, maxAttackParts, pathTarget) {
	let maxParts = null;
	if (maxAttackParts) {
		maxParts = {attack: maxAttackParts};
	}

	let position = this.pos;
	if (this.room.storage) {
		position = this.room.storage.pos;
	}

	return this.createManagedCreep({
		role: 'brawler',
		bodyWeights: {move: 0.5, attack: 0.3, heal: 0.2},
		maxParts,
		memory: {
			storage: utilities.encodePosition(position),
			target: utilities.encodePosition(targetPosition),
			pathTarget,
		},
	});
};

StructureSpawn.prototype.spawnClaimer = function (targetPosition, mission) {
	const setCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];

	let numSets = Math.floor(this.room.energyCapacityAvailable / setCost);
	if (numSets < 2) return false;

	if (numSets > 5) {
		numSets = 5;
	}

	const body = _.fill(new Array(numSets), CLAIM).concat(_.fill(new Array(numSets), MOVE));

	return this.createManagedCreep({
		role: 'claimer',
		body,
		memory: {
			target: utilities.encodePosition(targetPosition),
			mission,
		},
	});
};

StructureSpawn.prototype.getHaulerBodyWeights = function () {
	return {move: 0.35, work: 0.05, carry: 0.6};
};

/**
 * Spawns a new hauler.
 */
StructureSpawn.prototype.spawnHauler = function (targetPosition, maxCarryParts) {
	let maxParts = null;
	if (maxCarryParts) {
		maxParts = {carry: maxCarryParts};
	}

	let position = this.pos;
	if (this.room.storage) {
		position = this.room.storage.pos;
	}

	const bodyWeights = this.getHaulerBodyWeights();

	return this.createManagedCreep({
		role: 'hauler',
		bodyWeights,
		maxParts,
		memory: {
			storage: utilities.encodePosition(position),
			source: utilities.encodePosition(targetPosition),
		},
	});
};

/**
 * Spawns a new dismantler.
 */
StructureSpawn.prototype.spawnDismantler = function (targetRoom) {
	let boosts;
	if (this.room.canSpawnBoostedCreeps()) {
		const availableBoosts = this.room.getAvailableBoosts('dismantle');
		let bestBoost;
		for (const resourceType in availableBoosts || []) {
			if (availableBoosts[resourceType].available >= 50) {
				if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
					bestBoost = resourceType;
				}
			}
		}

		if (bestBoost) {
			boosts = {
				work: bestBoost,
			};
		}
	}

	return this.createManagedCreep({
		role: 'dismantler',
		bodyWeights: {move: 0.35, work: 0.65},
		memory: {
			sourceRoom: this.pos.roomName,
			targetRoom,
			boosts,
		},
	});
};

/**
 * Spawns a new harvester.
 */
StructureSpawn.prototype.spawnHarvester = function (force, maxSize, sourceID) {
	let minCost = null;
	if (force) {
		minCost = 200;
	}

	return this.createManagedCreep({
		role: 'harvester',
		bodyWeights: {move: 0.1, work: 0.7, carry: 0.2},
		minCost,
		maxParts: maxSize ? {work: maxSize} : null,
		memory: {
			singleRoom: this.pos.roomName,
			fixedSource: sourceID,
		},
	});
};

/**
 * Spawns a new power harvester.
 */
StructureSpawn.prototype.spawnPowerHarvester = function (targetRoom, isHealer) {
	const bodyParts = [];
	let functionalPart = ATTACK;
	if (isHealer) {
		functionalPart = HEAL;
	}
	for (let i = 0; i < MAX_CREEP_SIZE; i++) {
		// First half is all move parts.
		if (i < MAX_CREEP_SIZE / 2) {
			bodyParts.push(MOVE);
			continue;
		}

		// The rest is functional parts.
		bodyParts.push(functionalPart);
	}

	return this.createManagedCreep({
		role: 'harvester.power',
		body: bodyParts,
		memory: {
			sourceRoom: this.pos.roomName,
			targetRoom,
			isHealer,
		},
	});
};

/**
 * Spawns a new power hauler.
 */
StructureSpawn.prototype.spawnPowerHauler = function (targetRoom) {
	return this.createManagedCreep({
		role: 'hauler.power',
		bodyWeights: {move: 0.35, carry: 0.65},
		memory: {
			sourceRoom: this.pos.roomName,
			targetRoom,
		},
	});
};

/**
 * Spawns a new gifter.
 */
StructureSpawn.prototype.spawnGift = function () {
	return this.createManagedCreep({
		role: 'gift',
		bodyWeights: {move: 0.2, carry: 0.8},
		memory: {
			origin: this.pos.roomName,
		},
	});
};

/**
 * Spawns a new mineral harvester.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnMineralHarvester = function () {
	if (this.isFullOnMinerals()) return false;

	// Gather some information.
	// @todo This could be done on script startup and partially kept in room memory.
	const mineralHarvesters = this.creepsByRole['harvester.minerals'] || {};
	const minerals = this.room.find(FIND_MINERALS, {
		filter: mineral => {
			const extractors = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: structure => structure.structureType === STRUCTURE_EXTRACTOR && structure.isActive(),
			});

			if (extractors.length > 0) {
				return true;
			}

			return false;
		},
	});

	// We assume there is always at most one mineral deposit in a room.
	if (mineralHarvesters.length > 0 || minerals[0].mineralAmount === 0) return false;

	let boosts = null;
	if (this.room.canSpawnBoostedCreeps()) {
		const availableBoosts = this.room.getAvailableBoosts('harvest');
		let bestBoost;
		for (const resourceType in availableBoosts || []) {
			if (availableBoosts[resourceType].available >= 50) {
				if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
					bestBoost = resourceType;
				}
			}
		}

		if (bestBoost) {
			boosts = {
				work: bestBoost,
			};
		}
	}

	return this.createManagedCreep({
		role: 'harvester.minerals',
		bodyWeights: {move: 0.35, work: 0.3, carry: 0.35},
		boosts,
		memory: {
			singleRoom: this.pos.roomName,
			fixedMineralSource: minerals[0].id,
		},
	});
};

/**
 * Spawns squad units at this spawn if needed.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnSquadUnits = function () {
	const spawnFlags = this.room.find(FIND_FLAGS, {
		filter: flag => flag.name.startsWith('SpawnSquad:'),
	});
	for (const flag of spawnFlags) {
		const commandParts = flag.name.split(':');
		const squadName = commandParts[1];

		if (!Memory.squads || !Memory.squads[squadName]) continue;

		// @todo Initialize Game.squads in main loop and use that.
		const squad = Game.squads[squadName];
		if (squad.spawnUnit(this)) {
			return true;
		}
	}

	return false;
};

/**
 * Spawns a new repairer.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnBuilder = function (size) {
	const maxParts = {};
	if (size) {
		maxParts.work = size;
	}

	let boosts = null;
	if (this.room.canSpawnBoostedCreeps()) {
		const availableBoosts = this.room.getAvailableBoosts('repair');
		let bestBoost;
		for (const resourceType in availableBoosts || []) {
			if (availableBoosts[resourceType].available >= maxParts.work) {
				if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
					bestBoost = resourceType;
				}
			}
		}

		if (bestBoost) {
			boosts = {
				work: bestBoost,
			};
		}
	}

	return this.createManagedCreep({
		role: 'builder',
		bodyWeights: {move: 0.35, work: 0.35, carry: 0.3},
		maxParts,
		boosts,
		memory: {
			singleRoom: this.pos.roomName,
		},
	});
};

/**
 * Spawns a new transporter.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnTransporter = function (force, size) {
	let minCost = null;
	if (force) {
		minCost = 250;
	}

	const maxParts = {carry: 8};
	if (size) {
		maxParts.carry = size;
	}

	return this.createManagedCreep({
		role: 'transporter',
		bodyWeights: {move: 0.35, carry: 0.65},
		maxParts,
		minCost,
		memory: {
			singleRoom: this.pos.roomName,
		},
	});
};

/**
 * Spawns a new upgrader.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnUpgrader = function () {
	let bodyWeights = {move: 0.35, work: 0.3, carry: 0.35};
	if (this.room.memory.controllerContainer || this.room.memory.controllerLink) {
		bodyWeights = {move: 0.2, work: 0.75, carry: 0.05};
	}

	let boosts = null;
	if (this.room.canSpawnBoostedCreeps()) {
		const availableBoosts = this.room.getAvailableBoosts('upgradeController');
		let bestBoost;
		for (const resourceType in availableBoosts || []) {
			if (availableBoosts[resourceType].available >= CONTROLLER_MAX_UPGRADE_PER_TICK) {
				if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
					bestBoost = resourceType;
				}
			}
		}

		if (bestBoost) {
			boosts = {
				work: bestBoost,
			};
		}
	}

	return this.createManagedCreep({
		role: 'upgrader',
		bodyWeights,
		boosts,
		maxParts: {work: CONTROLLER_MAX_UPGRADE_PER_TICK},
		memory: {
			singleRoom: this.pos.roomName,
		},
	});
};

/**
 * Spawns a new remote builder.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteBuilder = function (targetPosition) {
	return this.createManagedCreep({
		role: 'builder.remote',
		bodyWeights: {move: 0.5, carry: 0.3, work: 0.2},
		memory: {
			target: utilities.encodePosition(targetPosition),
			starting: true,
		},
	});
};

/**
 * Spawns a new scout.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnScout = function () {
	return this.createManagedCreep({
		role: 'scout',
		body: [MOVE],
		memory: {
			origin: this.pos.roomName,
		},
	});
};

/**
 * Handles logic for spawning creeps in rooms, and spawning creeps to go
 * outside of these rooms.
 */
const spawnManager = {

	/**
	 * Manages spawning logic for all spawns.
	 */
	manageSpawns() {
		for (const room of _.values(Game.rooms)) {
			if (room.controller && room.controller.my) {
				room.manageSpawns();
			}
		}
	},

};

module.exports = spawnManager;
