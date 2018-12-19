'use strict';

var useProfiler = false;
var profiler = null;

if (useProfiler) {
  profiler = require('screeps-profiler');
  // Enable profiling of all methods in Game object prototypes defined up to now.
  profiler.enable();
  profiler.registerClass(Game.map, 'Map');
  profiler.registerClass(Game.market, 'Market');

  var Bay = require('manager.bay');
  var BoostManager = require('manager.boost');
  var Exploit = require('manager.exploit');
  var Logger = require('debug');
  var RoomPlanner = require('roomplanner');
  var Squad = require('manager.squad');
  profiler.registerClass(Bay, 'Bay');
  profiler.registerClass(BoostManager, 'BoostManager');
  profiler.registerClass(Exploit, 'Exploit');
  profiler.registerClass(Logger, 'Logger');
  profiler.registerClass(RoomPlanner, 'RoomPlanner');
  profiler.registerClass(Squad, 'Squad');

  var intelManager = require('manager.intel');
  var roleplay = require('manager.roleplay');
  var spawnManager = require('manager.spawn');
  var stats = require('stats');
  var utilities = require('utilities');
  profiler.registerObject(intelManager, 'intelManager');
  profiler.registerObject(roleplay, 'roleplay');
  profiler.registerObject(spawnManager, 'spawnManager');
  profiler.registerObject(stats, 'stats');
  profiler.registerObject(utilities, 'utilities');
}

module.exports = profiler;
