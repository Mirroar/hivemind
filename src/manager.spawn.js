'use strict';

/* global hivemind StructureSpawn Room RoomPosition BODYPART_COST OK
 FIND_MINERALS FIND_STRUCTURES STRUCTURE_EXTRACTOR FIND_FLAGS
SOURCE_ENERGY_CAPACITY ENERGY_REGEN_TIME CARRY_CAPACITY
CONTROLLER_RESERVE_MAX CLAIM MOVE CARRY */

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

	const totalCost = this.finalizeCreepBody(options, minCost, energyAvailable);

	if (energyAvailable >= totalCost) {
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
	hivemind.log('creeps', this.pos.roomName).debug('Spawning new creep:', newName);

	// Also notify room's boost manager if necessary.
	if (options.boosts && this.room.boostManager) {
		this.room.boostManager.markForBoosting(newName, options.boosts);
	}

	// Store role of spawning creep for visualization.
	this.memory.spawnRole = memory.role;

	return result;
};

/**
 * Generates creep body as it should be spawned.
 *
 * @param {object} options
 *   An object containing conditions for creating this creep.
 * @param {number} minCost
 *   Minimum cost of the creep to create.
 * @param {number} energyAvailable
 *   Amount of energy currently available for spawning.
 *
 * @return {number}
 *   Cost of the body as it will be generated.
 */
StructureSpawn.prototype.finalizeCreepBody = function (options, minCost, energyAvailable) {
	let maxCost = Math.max(minCost, energyAvailable);
	if (options.body) {
		// Use the actual cost of a creep with this body.
		let partsCost = 0;
		for (const part of options.body) {
			partsCost += BODYPART_COST[part];
		}

		// @todo Shouldn't this be math.max?
		return Math.min(maxCost, partsCost);
	}

	if (!options.bodyWeights) {
		throw new Error('No body definition for creep found.');
	}

	// Creep might be requested with a maximum energy cost.
	if (options.maxCost) {
		maxCost = Math.min(maxCost, options.maxCost);
	}

	// Creep might be requested with a part limit.
	// With theoretically unlimited energy, check how expensive the creep can become with maxSize.
	const tempBody = utilities.generateCreepBody(options.bodyWeights, this.room.energyCapacityAvailable, options.maxParts);
	if (tempBody) {
		let maxPartsCost = 0;
		for (const part of tempBody) {
			maxPartsCost += BODYPART_COST[part];
		}

		maxCost = Math.min(maxCost, maxPartsCost);
	}

	options.body = utilities.generateCreepBody(options.bodyWeights, maxCost, options.maxParts);

	return maxCost;
};

/**
 * WIP Replacement of manageSpawns using a priority queue and more caches.
 *
 * @return {boolean}
 *   True if a creep was spawned.
 */
Room.prototype.manageSpawnsPriority = function (spawnManager, roomSpawns) {
	// If all spawns are busy, no need to calculate what could be spawned.
	if (roomSpawns.length === 0) return true;

	// Have new spawn manager handle things if possible.
	return spawnManager.manageSpawns(this, roomSpawns);
};

/**
 * Spawns creeps in a room whenever needed.
 */
Room.prototype.manageSpawns = function (spawnManager, roomSpawns) {
	// If the new spawn code is trying to spawn something, give it priority.
	if (this.manageSpawnsPriority(spawnManager, roomSpawns)) return;

	for (const spawn of _.values(roomSpawns)) {
		if (spawn.spawning) continue;

		spawn.spawnCreeps();
		// @todo Stop spawning for a bit if creeps are queued for renewing.

		// Let only one spawner start spawning each tick to prevent confusion.
		break;
	}
};

/**
 * Spawns basic needed creeps at a spawn.
 */
StructureSpawn.prototype.spawnCreeps = function () {
	// Spawn squads.
	if (this.spawnSquadUnits()) return;

	// We've got nothing to do, how about some remote harvesting?
	const harvestPositions = [];
	const reservePositions = [];
	const remoteHarvestTargets = this.room.getRemoteHarvestTargets();
	for (const info of remoteHarvestTargets) {
		const roomIntel = hivemind.roomIntel(info.roomName);
		const sources = roomIntel.getSourcePositions();
		for (const pos of sources) {
			harvestPositions.push(new RoomPosition(pos.x, pos.y, info.roomName));
		}

		const position = roomIntel.getControllerPosition();
		if (position) {
			reservePositions.push(position);
		}
	}

	for (const harvestPosition of harvestPositions) {
		// First of all, if it's not safe, send a bruiser.
		if (this.spawnRemoteHarvestDefense(harvestPosition)) return;

		// If it's safe or brawler is sent, start harvesting.
		if (this.spawnRemoteHarvesters(harvestPosition)) return;
	}

	// No harvester spawned? How about some claimers?
	const safeRooms = this.roomPlanner ? this.roomPlanner.getAdjacentSafeRooms() : [];
	for (const roomName of safeRooms) {
		const position = hivemind.roomIntel(roomName).getControllerPosition();
		if (position) {
			reservePositions.push(position);
		}
	}

	for (const pos of reservePositions) {
		if (this.spawnRequestedClaimers(pos)) return;
	}

	// Last but not least: Scouts.
	let found = false;
	for (const i in Game.creepsByRole.scout || []) {
		if (Game.creepsByRole.scout[i].memory.origin === this.pos.roomName) {
			found = true;
			break;
		}
	}

	if (!found && this.room.needsScout()) {
		this.spawnScout();
	}
};

/**
 * Spawns remote harvesters to harvest a certain source.
 *
 * @param {RoomPosition} harvestPosition
 *   Position of the source that needs harvesting.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteHarvesters = function (harvestPosition) {
	const flagPosition = utilities.encodePosition(harvestPosition);
	const position = this.room.storage ? this.room.storage.pos : this.pos;
	const homeLocation = utilities.encodePosition(position);

	// Cache path when possible.
	try {
		utilities.precalculatePaths(this.room, harvestPosition);
	}
	catch (error) {
		console.log('Error in pathfinding:', error);
		console.log(error.stack);
	}

	if (!this.room.memory.remoteHarvesting || !this.room.memory.remoteHarvesting[flagPosition]) return false;

	const memory = this.room.memory.remoteHarvesting[flagPosition];
	let doSpawn = false;

	memory.harvesters = [];
	const harvesters = _.filter(Game.creepsByRole['harvester.remote'] || {}, creep => creep.memory.storage === homeLocation && creep.memory.source === flagPosition);

	const maxRemoteHarvesters = 1;
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

	for (const creep of _.values(harvesters)) {
		if (!travelTimeSpawn || creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500 || creep.spawning) {
			memory.harvesters.push(creep.id);
		}
	}

	if (memory.harvesters.length < maxRemoteHarvesters) {
		doSpawn = true;
	}

	if (doSpawn) {
		const result = this.spawnRemoteHarvester(harvestPosition);
		if (result) {
			const cost = this.calculateCreepBodyCost(Memory.creeps[result].body);
			stats.addRemoteHarvestCost(this.room.name, utilities.encodePosition(harvestPosition), cost);

			return true;
		}
	}

	if (this.spawnRemoteHarvestHaulers({
		homeLocation,
		travelTime,
		travelTimeSpawn,
		harvestPosition,
	})) return true;
};

/**
 * Spawns remote harvesters to harvest a certain source.
 *
 * @param {object} info
 *   Precalculated information from spawnRemoteHarvesters().
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteHarvestHaulers = function (info) {
	const flagPosition = utilities.encodePosition(info.harvestPosition);
	const memory = this.room.memory.remoteHarvesting[flagPosition];

	const haulerCount = _.size(_.filter(Game.creepsByRole.hauler || {}, creep =>
		creep.memory.storage === info.homeLocation &&
		creep.memory.source === flagPosition &&
		(creep.ticksToLive > Math.min(info.travelTimeSpawn || 0, 500) || creep.spawning)
	));

	let maxRemoteHaulers = 0;
	let maxCarryParts;
	if (memory.revenue > 0 || memory.hasContainer) {
		maxRemoteHaulers = 1;

		if (Game.rooms[info.harvestPosition.roomName]) {
			const room = Game.rooms[info.harvestPosition.roomName];
			if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username === utilities.getUsername()))) {
				maxRemoteHaulers = 2;
			}
		}
	}

	if (info.travelTime) {
		maxCarryParts = Math.ceil(info.travelTime * SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / CARRY_CAPACITY);

		// If we cannot create big enough haulers (yet), create more of them!
		const bodyWeights = this.getHaulerBodyWeights();
		const maxHauler = utilities.generateCreepBody(bodyWeights, this.room.energyCapacityAvailable, {carry: maxCarryParts});
		let carryCount = 0;
		for (const j in maxHauler) {
			if (maxHauler[j] === CARRY) {
				carryCount++;
			}
		}

		const multiplier = Math.min(maxCarryParts / carryCount, 3);
		maxRemoteHaulers *= multiplier;
	}

	if (haulerCount < maxRemoteHaulers) {
		// Spawn hauler if necessary, but not if harvester is needed first.
		const result = this.spawnHauler(info.harvestPosition, maxCarryParts);
		if (result) {
			const cost = this.calculateCreepBodyCost(Memory.creeps[result].body);
			stats.addRemoteHarvestCost(this.room.name, utilities.encodePosition(info.harvestPosition), cost);

			return true;
		}
	}
};

/**
 * Spawns harvesters to gather energy in other rooms.
 *
 * @param {RoomPosition} targetPosition
 *   Position of the source that needs harvesting.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
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

/**
 * Spawns brawlers to defend remote harvest rooms agains invaders.
 *
 * @param {RoomPosition} harvestPosition
 *   Position of the source that needs defending.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteHarvestDefense = function (harvestPosition) {
	const roomMemory = Memory.rooms[harvestPosition.roomName];
	if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) {
		let position = this.pos;
		if (this.room.storage) {
			position = this.room.storage.pos;
		}

		// Since we just want a brawler in the room - not one per remoteharvest source - generalize target position.
		const brawlPosition = new RoomPosition(25, 25, harvestPosition.roomName);

		const maxBrawlers = 1;
		const brawlers = _.filter(Game.creepsByRole.brawler || [], creep => {
			if (creep.memory.storage === utilities.encodePosition(position) && creep.memory.target === utilities.encodePosition(brawlPosition)) {
				return true;
			}

			return false;
		});

		if (!brawlers || brawlers.length < maxBrawlers) {
			const result = this.spawnBrawler(brawlPosition, 4, utilities.encodePosition(harvestPosition));
			if (result) {
				const position = utilities.encodePosition(harvestPosition);
				console.log('Spawning new brawler to defend', position, ':', result);

				const cost = this.calculateCreepBodyCost(Memory.creeps[result].body);
				stats.addRemoteHarvestDefenseCost(this.room.name, position, cost);
			}

			// Do not continue trying to spawn other creeps when defense is needed.
			return true;
		}
	}
};

/**
 * Spawns claimers to reserve requested rooms.
 *
 * @param {RoomPosition} claimPosition
 *   Position of the controller that should be reserved.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRequestedClaimers = function (claimPosition) {
	// Cache path when possible.
	try {
		utilities.precalculatePaths(this.room, claimPosition);
	}
	catch (error) {
		console.log('Error in pathfinding:', error);
		console.log(error.stack);
	}

	let doSpawn = false;

	const claimers = _.filter(Game.creepsByRole.claimer || {}, creep => creep.memory.mission === 'reserve');
	const maxClaimers = 1;
	const claimerIds = [];
	for (const creep of _.values(claimers)) {
		if (creep.memory.target === utilities.encodePosition(claimPosition)) {
			claimerIds.push(creep.id);
		}
	}

	if (claimerIds.length < maxClaimers) {
		doSpawn = true;
	}

	if (Memory.rooms[claimPosition.roomName] &&
		Memory.rooms[claimPosition.roomName].lastClaim &&
		Memory.rooms[claimPosition.roomName].lastClaim.value + (Memory.rooms[claimPosition.roomName].lastClaim.time - Game.time) > CONTROLLER_RESERVE_MAX * 0.5
	) {
		doSpawn = false;
	}

	if (doSpawn) {
		const result = this.spawnClaimer(claimPosition, 'reserve');

		if (result) {
			// @todo Add cost to a random harvest flag in the room.

			return true;
		}
	}
};

/**
 * Spawns a brawler to attacka a certain position.
 *
 * @param {RoomPosition} targetPosition
 *   Position the brawler needs to be sent to.
 * @param {number} maxAttackParts
 *   Maximum number of attack parts to use.
 * @param {string} pathTarget
 *   Encoded room position of harvest source for reusing pathfinder data.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
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

/**
 * Spawns a claimer to reserve or claim a room.
 *
 * @param {RoomPosition} targetPosition
 *   Position of the controller that should be reserved or claimed.
 * @param {string} mission
 *   What the claimer should do: "claim" or "reserve".
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
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

/**
 * Determine body weights for haulers.
 *
 * @return {object}
 *   An object containing body part weights, keyed by type.
 */
StructureSpawn.prototype.getHaulerBodyWeights = function () {
	return {move: 0.35, work: 0.05, carry: 0.6};
};

/**
 * Spawns a new hauler.
 *
 * @param {RoomPosition} targetPosition
 *   Position of the source that should be hauled from.
 * @param {number} maxCarryParts
 *   Maximum number of carry parts the hauler should have.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
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
