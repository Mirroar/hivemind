'use strict';

const useProfiler = false;
let profiler;

if (useProfiler) {
	profiler = require('./screeps-profiler');
	// Enable profiling of all methods in Game object prototypes defined up to now.
	profiler.enable();
	profiler.registerClass(Game.map, 'Map');
	profiler.registerClass(Game.market, 'Market');

	const Bay = require('./manager.bay');
	const BoostManager = require('./manager.boost');
	const Exploit = require('./manager.exploit');
	const Logger = require('./debug');
	const RoomPlanner = require('./room-planner');
	const Squad = require('./manager.squad');
	profiler.registerClass(Bay, 'Bay');
	profiler.registerClass(BoostManager, 'BoostManager');
	profiler.registerClass(Exploit, 'Exploit');
	profiler.registerClass(Logger, 'Logger');
	profiler.registerClass(RoomPlanner, 'RoomPlanner');
	profiler.registerClass(Squad, 'Squad');

	const stats = require('./stats');
	const utilities = require('./utilities');
	profiler.registerObject(stats, 'stats');
	profiler.registerObject(utilities, 'utilities');
}

module.exports = profiler;
