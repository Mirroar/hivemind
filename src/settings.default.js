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


	// Power mining:
	// Enable power mining in general.
	enablePowerMining: true,
	// Filter rooms where power mining is allowed to take place. This needs to be
	// a function that is passed a room name and returns true for allowed rooms.
	powerMineRoomFilter: null,
	// Spawn healers to deal with reflected damage from power sources.
	powerMineHealers: true,

	// Expansion:
	// Maximum amount of CPU that may be spent each tick on finding a suitable
	// expansion target.
	maxExpansionCpuPerTick: 30,
};
