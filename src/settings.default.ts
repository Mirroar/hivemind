/* global POWER_BANK_CAPACITY_MAX PWR_REGEN_SOURCE PWR_REGEN_MINERAL
PWR_OPERATE_CONTROLLER PWR_OPERATE_SPAWN PWR_OPERATE_TOWER PWR_OPERATE_EXTENSION
PWR_OPERATE_LAB PWR_OPERATE_OBSERVER PWR_OPERATE_TERMINAL PWR_OPERATE_FACTORY
PWR_OPERATE_STORAGE PWR_GENERATE_OPS */

/**
 * This file contains the default settings for hivemind.
 *
 * Please do not edit these settings directly, as they might be overwritten
 * should you update to a newer release of the bot.
 * Instead, you may create a file named `settings.local.js` where you may
 * override any setting from this file.
 *
 * Example `settings.local.js`:
 * @code
 * export default {
 *   visualizeNavMesh: true,
 *   enablePowerMining: Game.shard.name !== 'shard1',
 * };
 * @endcode
 *
 * You may also override any setting via memory within the game. You may use
 * the following method in the game's console:
 * @code
 * hivemind.settings.set('visualizeNavMesh', true);
 * @endcode
 */
const settings = {
	// Visualization:
	// If true, lines representing connections in the bot's nav mesh will be drawn
	// on the world map.
	visualizeNavMesh: false,

	// Remote mining:
	// The maximum distance for rooms to be mined.
	maxRemoteMineRoomDistance: 3,
	// The maximum path length from a source to a storage. Any more and the source
	// will not be mined.
	maxRemoteMinePathLength: 150,
	// Filter rooms where remote mining is allowed to take place. This needs to be
	// a function that is passed a room name and returns true for allowed rooms.
	remoteMineRoomFilter: null,

	// Power mining:
	// Enable power mining in general.
	enablePowerMining: true,
	powerMiningCheckInterval: 100,
	// Filter rooms where power mining is allowed to take place. This needs to be
	// a function that is passed a room name and returns true for allowed rooms.
	powerMineRoomFilter: null,
	powerBankMinAmount: POWER_BANK_CAPACITY_MAX / 4,
	powerMineCreepPriority: 3,
	powerHaulerMoveRatio: 0.35,
	minEnergyForPowerHarvesting: 75000,
	minEnergyForPowerProcessing: 100000,

	// Power creeps:
	powerPriorities: [
		PWR_OPERATE_FACTORY,
		PWR_REGEN_SOURCE,
		PWR_REGEN_MINERAL,
		PWR_OPERATE_STORAGE,
		PWR_GENERATE_OPS,
		PWR_OPERATE_CONTROLLER,
		PWR_OPERATE_SPAWN,
		PWR_OPERATE_TOWER,
		PWR_OPERATE_EXTENSION,
		PWR_OPERATE_LAB,
		PWR_OPERATE_OBSERVER,
		PWR_OPERATE_TERMINAL,
	],
	operatorEachRoom: false,
	operatorNames: ['Jekyll', 'Hyde', 'Banner', 'Robotnik', 'Strange', 'Venkman', 'Dolittle', 'Zhivago', 'Crane', 'McCoy', 'VanHelsing', 'Frankenstein', 'Scully', 'Connors', 'Lecter'],

	// Scouting:
	// Interval for running room prioritizing process.
	scoutProcessInterval: 25,
	// Maximum amount of CPU to spend on prioritizing rooms when the process runs.
	maxRoomPrioritizationCpuPerTick: 50,
	maxScoutsPerRoom: 1,
	scoutSpawnPriority: 1,
	roomScoutInterval: 5000,
	highwayScoutInterval: 1000,
	roomIntelCacheDuration: 500,

	// Expansion:
	// Number of ticks we may cache expansion scores.
	expansionScoreCacheDuration: 20000,
	// Maximum amount of CPU that may be spent each tick on finding a suitable
	// expansion target.
	maxExpansionCpuPerTick: 30,

	// Expansion scoring:
	expansionScoreBonusHighwayExit: 0,

	// Room planning:
	enableMinCutRamparts: false,
	minCutRampartDistance: 4,

	// Room management:
	// Number of hits for walls / ramparts needed for more expensive structures
	// to be built.
	minWallIntegrity: 500000,
	constructLabs: true,
	constructNukers: true,
	constructPowerSpawns: true,
	constructObservers: true,
	minEnergyToUpgradeAtRCL8: 50000,
	rampartWhitelistedUsers: [],
	maxVisitorsPerUser: 0,

	// Trade:
	enableTradeManagement: true,
	allowBuyingEnergy: false,
	allowBuyingPixels: false,
	allowSellingPower: true,
	allowSellingOps: true,
};

export default settings;
