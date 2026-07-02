/**
 * Contains small code snippets for use in the console. Do not require this file.
 */
/* global FIND_CONSTRUCTION_SITES */

// Remove all constructions sites in a room you have vision in:
_.forEach(Game.rooms.E49S48.find(FIND_CONSTRUCTION_SITES), s => s.remove());

// Show CPU usage for all processes for 100 ticks.
Memory.hivemind.showProcessDebug = 100;

// Draw room planner debug visuals for 100 ticks.
Game.rooms.E49S51.roomPlanner.memory.drawDebug = 100;

// Re-run room planner for a room.
Game.rooms.E49S51.roomPlanner.startRoomPlanGeneration();

// Find out which processes use a lot of CPU
JSON.stringify(_.sortBy(_.map(Memory.hivemind.process, (a, b) => {a.name = b; return a}), a => -a.cpu));

// Find out which operations use a lot of CPU
const m = []; _.each(Memory.operations, (o, name) => {m.push({name, cpu: o.stats.cpu / o.statTicks})}); JSON.stringify(_.sortBy(m, 'cpu'));

// Find out which mining operations are most profitable per CPU used
const mem = []; _.each(Memory.operations, (o, name) => {if (o.type !== 'mining') return; mem.push({name, income: o.stats.energy / o.stats.cpu})}); JSON.stringify(_.sortBy(mem, 'income'));

// Find out where a lot of memory is used:
JSON.stringify(_.sortBy(_.map(Memory, (data, key) => {return {key, size: JSON.stringify(data).length}}), 'size'));
JSON.stringify(_.reduce(_.map(Memory.rooms, (roomData) => {const result = {}; _.each(roomData, (data, key) => result[key] = JSON.stringify(data).length); return result}), (total, item) => {_.each(item, (value, key) => total[key] = (total[key] || 0) + value); return total}));

// Calculate room value.
// @todo update with roomStatus info
const p = new (require('process.strategy.scout')); p.generateMineralStatus(); Memory.hivemind.canExpand = true; const r = []; _.each(Game.rooms, room => {if (!room.isMine()) return; const i = p.calculateExpansionScore(room.name);i.roomName = room.name; r.push(i)}); Memory.hivemind.canExpand = false; console.log(JSON.stringify(r));

// Find energy source options for a transporter creep.
JSON.stringify(_.map(Game.creeps.T_ju.getAvailableEnergySources(), option => {option.object = (option.object || {}).id; return option}))

// Find out how many creeps of each role are currently spawned.
_.each(Game.creepsByRole, (g, n) => console.log(_.size(g), n));

// Force expansion to a certain room.
r = {roomName: 'E19N24', spawnRoom: 'E16N22'}; (new ExpandProcess()).startExpansion(r);

// Stop expansion to current target.
(new ExpandProcess()).recordFailedExpansion(); (new ExpandProcess()).stopExpansion();

// Force evacuation and abandonment of a certain room.
const roomName = 'E43S53'; Game.rooms[roomName].setEvacuating(true); Memory.strategy.expand.evacuatingRoom = {name: roomName, cooldown: null};

// Send a squad to operate in a room.
const s = container.get('SquadManager').getOrCreateSquad('squadName'); s.setSpawn('W25S18'); s.setTarget(new RoomPosition(24, 24, 'W28S19')); s.addUnit('ranger');

// Force abandonment of a weak room.
delete Memory.strategy.expand.evacuatingRoom; (new ExpandProcess()).abandonWeakRooms();

// Show which rooms are evacuating, along with their evaluation scores.
_.each(Game.myRooms, r => {console.log(r.name, !!r.isEvacuating(), container.get('RoomStatus').getExpansionScore(r.name))});

// Repeatedly send resources between two rooms.
const t = new TradeRoute('energy'); t.setOrigin('E4N37'); t.setTarget('E4N43'); t.setActive(true); t.setResourceType(RESOURCE_ENERGY);

// Check what resources are trying to be moved around
JSON.stringify(container.get('TradeRouteManager').getAvailableTransportRoutes(), null, 2);
JSON.stringify(Game.rooms.E45S51.getResourceState(), null, 2);
