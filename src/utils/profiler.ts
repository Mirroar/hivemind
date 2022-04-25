import profiler from 'screeps-profiler';

import Bay from 'manager.bay';
import BoostManager from 'manager.boost';
import Exploit from 'manager.exploit';
import Logger from 'utils/debug';
import RoomPlanner from 'room/planner/room-planner';
import Squad from 'manager.squad';
import stats from 'utils/stats';
import utilities from 'utilities';

const useProfiler = false;

if (useProfiler) {
	// Enable profiling of all methods in Game object prototypes defined up to now.
	profiler.enable();
	profiler.registerClass(Game.map, 'Map');
	profiler.registerClass(Game.market, 'Market');

	profiler.registerClass(Bay, 'Bay');
	profiler.registerClass(BoostManager, 'BoostManager');
	profiler.registerClass(Exploit, 'Exploit');
	profiler.registerClass(Logger, 'Logger');
	profiler.registerClass(RoomPlanner, 'RoomPlanner');
	profiler.registerClass(Squad, 'Squad');

	profiler.registerObject(stats, 'stats');
	profiler.registerObject(utilities, 'utilities');
}

export {profiler, useProfiler};
