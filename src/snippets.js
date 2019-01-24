/**
 * @file
 * Contains small code snippets for use in the console. Do not require this file.
 */

// Remove all constructions sites in a roon you have vision in:
_.forEach(Game.rooms.E49S48.find(FIND_CONSTRUCTION_SITES), (s) => s.remove());

// Find out which rooms are of interest for expansion.
JSON.stringify(_.max(Memory.strategy.roomList, 'expansionScore'));
JSON.stringify(_.sortBy(Memory.strategy.roomList, 'expansionScore'));

// Re-run room planner for a room.
Memory.rooms.E49S51.roomPlanner.plannerVersion = 0;
