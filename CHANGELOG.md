# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Added this changelog.
- Added xo for ensuring consistent code style.
- Added ava for automated testing, along with a small set of tests.
- Power mining can now be disabled by setting `Memory.disablePowerHarvesting = true`.
- Throttling to 20 cpu can be activated by setting `Memory.isAccountThrottled = true`.
- Added Hivemind class that functions as a kernel to start processes, handle throttling, etc.
- Added Process class that serves as a base for processes the kernel can run.
- Added LinkNetwork class that handles logic concerning multiple StructureLink objects in a room.
- Added Relations class that manages relations with other players.
- Added RoomIntel class that replaces direct accesses to data in `Memory.rooms[roomName].intel`.
- Added creep role "gift" that takes excess resources and runs them around the map for other players to hunt.
- Spawn reserver creeps for rooms that are deemed "safe" by the room planner, because they cannot be accessed from outside our empire.
- Other nearby rooms will send remote builders to help out with expansion.
- When the controller of an expansion is not direcly reachable (because structures are in the way), tunnels are built to reach it.
- We start building roads and containers in new rooms even before they are claimed.
- Automatic expansion is now aborted if the room does not grow fast enough.
- Maximum scout distance is now managed dynamically based on memory usage.
- Remote harvesters try to dismantle structures that block their path.
- Creeps can now pick up resources from tombstones.

### Changed
- Game object prototype enhancements have been moved into separate files like `room.prototype.intel.js`.
- Several global and room tasks have been moved into new processes.
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
- When the path to an expansion is blocked, a new spawn room is chosen, or expansion is aborted.
- Expansion Score is only calculated when looking for a new expansion.
- Military creeps will now attack unowned structures if a flag has been placed directly on it.
- Upgraders will move as close to their controller as possible for less of a chance of blocking other creeps.
- Remote mining will try not to run paths through rooms owned or reserved by other players.
- Handle rooms that have been downgraded (or reclaimed) and contain inactive structures much better.
- Walls and other structures are now removed more intelligently for newly claimed rooms.
- RoomPlanner will stop trying to generate a layout if it fails multiple times.
- RoomPlanner places some buildings differently, notably nukers no longer cover the room's center.
- RoomPlanner places extension bays with less than 7 extensions if in exchange they are much closer to the room's center.
- RoomPlanner no longer places towers outside of the area covered by ramparts, and places them (and their access roads) more intelligently in general.
- Roads to the controller are built much earlier in new rooms.
- Power spawns and nukers are only supplied if the room has a surplus of energy.
- Attack creeps that are not considered dangerous if they are in rooms we own / reserve.
- Optimized memory usage of serialized paths and room cost matrixes.

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

