/**
 * Contains small code snippets for use in the console. Do not require this file.
 */
/* global FIND_CONSTRUCTION_SITES */

// Remove all constructions sites in a roon you have vision in:
_.forEach(Game.rooms.E49S48.find(FIND_CONSTRUCTION_SITES), s => s.remove());

// Find out which rooms are of interest for expansion.
JSON.stringify(_.max(Memory.strategy.roomList, 'expansionScore'));
JSON.stringify(_.sortBy(Memory.strategy.roomList, 'expansionScore'));

// Re-run room planner for a room.
Memory.rooms.E49S51.roomPlanner.plannerVersion = 0;

// Find out which processes use a lot of CPU
JSON.stringify(_.sortBy(_.map(Memory.hivemind.process, (a, b) => {a.name = b; return a}), a => -a.cpu));

// Find out where a lot of memory is used:
JSON.stringify(_.sortBy(_.map(Memory, (data, key) => {return {key, size: JSON.stringify(data).length}}), 'size'));
JSON.stringify(_.reduce(_.map(Memory.rooms, (roomData) => {const result = {}; _.each(roomData, (data, key) => result[key] = JSON.stringify(data).length); return result}), (total, item) => {_.each(item, (value, key) => total[key] = (total[key] || 0) + value); return total}));

// Calculate room value.
const p = new (require('process.strategy.scout')); p.generateMineralStatus(); Memory.hivemind.canExpand = true; const r = []; _.each(Game.rooms, room => {if (!room.controller || !room.controller.my) return; const i = p.calculateExpansionScore(room.name);i.roomName = room.name; r.push(i)}); Memory.hivemind.canExpand = false; console.log(JSON.stringify(r));

// Find energy source options for a transporter creep.
JSON.stringify(_.map(Game.creeps.T_ju.getAvailableEnergySources(), option => {option.object = (option.object || {}).id; return option}))
