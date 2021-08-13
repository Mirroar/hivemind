'use strict';

const useProfiler = false;
let profiler;

if (useProfiler) {
	profiler = require('./screeps-profiler');
	// Enable profiling of all methods in Game object prototypes defined up to now.
	profiler.enable();
	profiler.registerClass(Game.map, 'Map');
	profiler.registerClass(Game.market, 'Market');

	import Bay from './manager.bay';
	import BoostManager from './manager.boost';
	import Exploit from './manager.exploit';
	import Logger from './debug';
	import RoomPlanner from './room-planner';
	import Squad from './manager.squad';
	profiler.registerClass(Bay, 'Bay');
	profiler.registerClass(BoostManager, 'BoostManager');
	profiler.registerClass(Exploit, 'Exploit');
	profiler.registerClass(Logger, 'Logger');
	profiler.registerClass(RoomPlanner, 'RoomPlanner');
	profiler.registerClass(Squad, 'Squad');

	import stats from './stats';
	import utilities from './utilities';
	profiler.registerObject(stats, 'stats');
	profiler.registerObject(utilities, 'utilities');
}

export default profiler;
