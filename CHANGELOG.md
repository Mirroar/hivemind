# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Added this changelog.
- Power mining can now be disabled by setting `Memory.disablePowerHarvesting = true`.
- Throttling to 20 cpu can be activated by setting `Memory.isAccountThrottled = true`.
- Added Hivemind class that functions as a kernel to start processes, handle throttling, etc.
- Added Process class that serves as a base for processes the kernel can run.
- Added LinkNetwork class that handles logic concerning multiple StructureLink objects in a room.
- Added Relations class that manages relations with other players.
- Added RoomIntel class that replaces direct accesses to data in `Memory.rooms[roomName].intel`.
- Added creep role "gift" that takes excess resources and runs them around the map for other players to hunt.
- Spawn reserver creeps for rooms that are deemed "safe" by the room planner, because they cannot be accessed from outside our empire.

### Changed
- Game object prototype enhancements have been moved into separate files like `room.prototype.intel.js`.
- Several global and room tasks have been moved into new processes.
- Link management is now more intelligent instead of only sending energy to controller link.
- Several function have been refactored for better readability and to reduce duplication.
- We no longer create a new instace of the Logger class for almost every log message. Instead, the Hivemind class has a factory method for getting a Logger.
- Expansions to other rooms will now avoid being close to other players, and prefer rooms that have many energy sources in adjacent rooms but few exit sides.
- Expansions are now taken up to 7 rooms away (up from 5).
- Military creeps will now attack unowned structures if a flag has been placed directly on it.
- Remote mining will try not to run paths through rooms owned or reserved by other players.

### Removed
- `pathfinding.js` has been removed in favor of `creep.prototype.movement.js`.
- `creep.general.js` has been removed in favor of prototype files.
- `manager.strategy.js` has been removed in favor of `process.strategy.*.js` files.
- `manager.structure.js` has been removed in favor of `process.empire.*.js` files.
- `Game.isAlly()` has been removed in favor of `Relations.isAlly()`.

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

