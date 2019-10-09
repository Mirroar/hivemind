'use strict';

const Process = require('./process');

module.exports = class SpawnPowerCreepsProcess extends Process {
	/**
	 * Spawns power creeps in their assigned rooms.
	 */
	run() {
		_.each(Game.powerCreeps, creep => {
			if (creep.shard) return;
			if (creep.spawnCooldownTime && creep.spawnCooldownTime > Date.now()) return;
			if (!creep.memory.singleRoom) return;

			const room = Game.rooms[creep.memory.singleRoom];
			if (!room || !room.powerSpawn) return;

			Game.notify('⟳ Respawned power creep ' + creep.name + ' in ' + room.name);
			creep.spawn(room.powerSpawn);
		});
	}
};
