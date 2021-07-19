'use strict';

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
 * module.exports = {
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
module.exports = {
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

	// Power mining:
	// Enable power mining in general.
	enablePowerMining: true,
	powerMiningCheckInterval: 100,
	// Filter rooms where power mining is allowed to take place. This needs to be
	// a function that is passed a room name and returns true for allowed rooms.
	powerMineRoomFilter: null,
	// Spawn healers to deal with reflected damage from power sources.
	powerMineHealers: true,

	// Scouting:
	// Interval for running room prioritizing process.
	scoutProcessInterval: 25,
	// Maximum amount of CPU to spend on prioritizing rooms when the process runs.
	maxRoomPrioritizationCpuPerTick: 50,
	maxScoutsPerRoom: 1,
	scoutSpawnPriority: 1,

	// Expansion:
	// Number of ticks we may cache expansion scores.
	expansionScoreCacheDuration: 20000,
	// Maximum amount of CPU that may be spent each tick on finding a suitable
	// expansion target.
	maxExpansionCpuPerTick: 30,

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

	// Trade:
	enableTradeManagement: true,
	allowBuyingEnergy: false,
	allowBuyingPixels: false,
	allowSellingPower: true,
	allowSellingOps: true,
};
