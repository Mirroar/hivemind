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
	// Relations:
	// If true, any player that is not declared to be your ally will be treated
	// as an enemy, rather than neutral, and actively harrassed.
	treatNonAlliesAsEnemies: false,

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
	minRclForPowerMining: 8,
	maxRangeForPowerMining: 5,
	powerMiningCheckInterval: 100,
	// Filter rooms where power mining is allowed to take place. This needs to be
	// a function that is passed a room name and returns true for allowed rooms.
	powerMineRoomFilter: null,
	powerBankMinAmount: POWER_BANK_CAPACITY_MAX / 4,
	powerMineCreepPriority: 3,
	powerHaulerMoveRatio: 0.35,
	minEnergyForPowerHarvesting: 75_000,
	minEnergyForPowerProcessing: 100_000,

	// Commodities:
	enableDepositMining: true,
	maxRangeForDepositMining: 5,
	maxDepositCooldown: 100,
	depositMineRoomFilter: null,
	minEnergyForDepositMining: 20_000,
	minRclForDepositMining: 8,

	// Power creeps:
	powerCreepUpgradeCheckInterval: 1000,
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
	automaticallyUpgradePowerCreeps: true,
	operatorEachRoom: false,
	prioritizeFactoryLevels: false,
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
	expansionScoreCacheDuration: 20_000,
	// Maximum amount of CPU that may be spent each tick on finding a suitable
	// expansion target.
	maxExpansionCpuPerTick: 30,

	// Expansion scoring:
	expansionScoreBonusHighwayExit: 0,

	// Room planning:
	enableMinCutRamparts: false,
	minCutRampartDistance: 4,
	visualizeRoomPlan: false,

	// Room management:
	// Number of hits for walls / ramparts needed for more expensive structures
	// to be built.
	minWallIntegrity: 500_000,
	// Toggles whether certain specialized structures should be built.
	constructLabs: true,
	constructNukers: true,
	constructPowerSpawns: true,
	constructObservers: true,
	constructFactories: true,
	// Manages energy spending in high level rooms.
	minEnergyToUpgradeAtRCL8: 50_000,
	minEnergyForNuker: 50_000,
	// The ratio of leftover energy to put into power processing vs. GPL.
	// Must be between 0 and 1.
	powerProcessingEnergyRatio: 0.5,

	// List of user names that may move through our ramparts.
	rampartWhitelistedUsers: [],
	maxVisitorsPerUser: 0,
	dismantleUnwantedRamparts: true,

	// Saves statistics about the time it takes to reach certain milestones.
	// Available in `Memory.roomStats`.
	recordRoomStats: true,

	// Trade:
	enableTradeManagement: true,
	allowBuyingEnergy: false,
	allowBuyingPixels: false,
	allowSellingPower: true,
	allowSellingOps: true,

	// Seasons:
	season4EnableCaravanDelivery: false,
};

export default settings;
