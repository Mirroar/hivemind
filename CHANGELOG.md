# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Added `cache.js` containing general caching functionality for use in other modules.
- Added slightly modified version of `packrat.js` that can deal with higher numbers in room names.

### Removed
- Removed `utilities.getCache()` in favor of new caching API.

## [2.0.0] - 2021-05-01
### Added
- Added this changelog.
- Added xo for ensuring consistent code style.
- Added ava for automated testing, along with a small set of tests.
- Power mining can now be disabled by setting `Memory.disablePowerHarvesting = true`.
- Throttling to 20 cpu can be activated by setting `Memory.isAccountThrottled = true`.
- Added Hivemind class that functions as a kernel to start processes, handle throttling, profiling, etc.
- Added Process class that serves as a base for processes the kernel can run.
- Added LinkNetwork class that handles logic concerning multiple StructureLink objects in a room.
- Added Relations class that manages relations with other players.
- Added RoomIntel class that replaces direct accesses to data in `Memory.rooms[roomName].intel`.
- Added RoomManager class to supplement room planner and separate their concerns.
- Added CreepManager class for running all creeps' logic and throttling.
- Added creep role "gift" that takes excess resources and runs them around the map for other players to hunt.
- Spawn reserver creeps for rooms that are deemed "safe" by the room planner, because they cannot be accessed from outside our empire.
- Other nearby rooms will send remote builders to help out with expansion.
- When the controller of an expansion is not direcly reachable (because structures are in the way), tunnels are built to reach it.
- We start building roads and containers in new rooms even before they are claimed.
- Automatic expansion is now aborted if the room does not grow fast enough.
- Maximum scout distance is now managed dynamically based on memory usage.
- Remote harvesters try to dismantle structures that block their path.
- Creeps can now pick up resources from tombstones and ruins.
- Added some useful code snippets to `snippets.js`.
- Added support for operator power creeps, with automatic upgrades, assignment and spawning.
- Room planner places walls near spawns so creeps can no longer be spawned in a direction thar would cause them to be stuck afterwards.
- Cache some data (like cost matrices) in heap.
- Automatically remove graffiti (signs) from our own controllers.
- Abandoned resources (like old storaged) in scouted rooms are detected for later gathering.
- Added daily report emails to notify of GLC, GPL, Power harvesting and remote harvesting activity.
- Added the ability to scout through intershard portals.
- Added the ability to try and expand to an adjacent shard.
- Safe mode is triggered automatically when a room's ramparts are almost broken.
- Added the ability to automatically abandon and unclaim rooms with a low score in favor of much better rooms.
- Automatically detect and attack invader cores blocking our remote harvesting.
- Added a nav mesh for improved inter-room pathfinding, used by scouts and squad creeps.
- Inter-room pathfinding can now avoid source keepers and travel through their rooms.
- Claimers can now attack controllers reserved by other players.
- Added simple stats about RCL levelups for optimizing spawning on new servers.

### Changed
- Game object prototype enhancements have been moved into separate files like `room.prototype.intel.js`.
- Several global and room tasks have been moved into new processes.
- A lot of things no ĺonger run at a fixed tick interval, but get throttled based on bucket an CPU usage.
- Link management is now more intelligent instead of only sending energy to controller link.
- Several function have been refactored for better readability and to reduce duplication.
- We no longer create a new instace of the Logger class for almost every log message. Instead, the Hivemind class has a factory method for getting a Logger.
- Observers may now observe multiple rooms during successive ticks if scout process deems it necessary.
- Expansions to other rooms will now be selected using more criteria:
  - avoid being close to other players
  - avoid expanding too close to our own rooms if it restricts remote harvesting
  - prefer rooms that have many energy sources in adjacent rooms
  - prefer rooms with mineral types we have few sources of
  - prefer rooms with few exit sides and tiles
  - prefer rooms that create safe exits for other nearby rooms
  - prefer rooms with open space and few swamp tiles
- Expansions are now taken up to 7 rooms away (up from 5) and no longer have a minimum distance.
- Expansions are taken even at high CPU usage if a high level of remote harvesting is going on.
- Expansions are now only taken if a safe path to the target room exists.
- Spawn room for expansion squad is now chosen dynamically.
- Up to 5 nearby rooms may send creeps to assist in expanding.
- When the path to an expansion is blocked, a new spawn room is chosen, or expansion is aborted.
- Expansion Score is now cached for quite a while.
- Improved expansion score calculation.
- Expansion score is calculated and kept for owned rooms as an indicator of a room's potential.
- Military creeps will now attack unowned structures if a flag has been placed directly on it.
- Upgraders will move as close to their controller as possible for less of a chance of blocking other creeps.
- Remote mining will try not to run paths through rooms owned or reserved by other players.
- Handle rooms that have been downgraded (or reclaimed) and contain inactive structures much better.
- Walls and other structures are now removed more intelligently for newly claimed rooms.
- RoomPlanner will stop trying to generate a layout if it fails multiple times.
- RoomPlanner places some buildings differently, notably nukers no longer cover the room's center.
- RoomPlanner places extension bays with less than 7 extensions if in exchange they are much closer to the room's center.
- RoomPlanner no longer places towers outside of the area covered by ramparts, and places them (and their access roads) more intelligently in general.
- RoomPlanner places and builds links in a more reasonable order (at controller, at sources, then at storage).
- RoomPlanner places a bay with spawn, link, container and extensions around each source's harvest position.
- Roads to the controller are built much earlier in new rooms.
- Power spawns and nukers are only supplied if the room has a surplus of energy.
- Attack creeps that are not considered dangerous if they are in rooms we own / reserve.
- Optimized memory usage of serialized paths and room cost matrixes.
- Creeps for power harvesting are only spawned if there is enough energy for all of them.
- Checking if a structure is active is cached to reduce CPU usage.
- Room debug visuals are only drawn when requested.
- Ask room planner for positions of important structures instead of guessing.
- Creep roles have a new class-based format.
- E-Mail notifications use emoticons so they're easily distinguished from normal messages.
- Spawn manager has been rewritten, and spawn options live in their own classes named `spawn-role.*.js`.
- Room resources are evacuated faster.
- Scouts are much less likely to get stuck in a room or room border.
- When defending remote harvest locations, adjust to enemy power, and limit spawn rate of defensive creeps.
- Rooms with low amounts of energy stored will limit spawning and repairing.

### Removed
- `pathfinding.js` has been removed in favor of `creep.prototype.movement.js`.
- `creep.general.js` has been removed in favor of prototype files.
- `manager.intel.js` has been removed in favor of RoomIntel.
- `manager.strategy.js` has been removed in favor of `process.strategy.*.js` files.
- `manager.structure.js` has been removed in favor of `process.empire.*.js` files.
- `Game.isAlly()` has been removed in favor of `Relations.isAlly()`.
- Several older pieces of code that allowed interaction using flags was removed.

## [1.0.4] - 2018-11-10
### @todo

## [1.0.3] - 2017-03-17
### @todo

## [1.0.2] - 2017-03-01
### @todo

## [1.0.1] - 2017-02-25
### @todo

## 1.0.0 - 2017-02-17
### @todo

