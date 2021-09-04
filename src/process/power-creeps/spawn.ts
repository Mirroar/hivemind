import Process from 'process/process';

export default class SpawnPowerCreepsProcess extends Process {
	/**
	 * Spawns power creeps in their assigned rooms.
	 */
	run() {
		_.each(Game.powerCreeps, creep => {
			if (!creep.memory.role) creep.memory.role = 'operator';

			if (creep.shard) return;
			if (creep.spawnCooldownTime && creep.spawnCooldownTime > Date.now()) return;

			this.assignPowerCreep(creep);
			if (!creep.memory.singleRoom) return;

			const room = Game.rooms[creep.memory.singleRoom];
			if (!room || !room.powerSpawn) return;

			Game.notify('⟳ Respawned power creep ' + creep.name + ' in ' + room.name);
			creep.spawn(room.powerSpawn);
		});
	}

	/**
	 * Assigns power creep to best room without a power creep.
	 *
	 * @todo This gets more complicated once factories are involved.
	 *
	 * @param {PowerCreep} creep
	 *   The power creep that needs to be assigned a room.
	 */
	assignPowerCreep(creep) {
		const roomsWithoutPC = _.filter(Game.rooms, room => {
			if (!room.isMine()) return false;
			if (!room.powerSpawn) return false;

			const powerCreepsInRoom = _.filter(Game.powerCreeps, creep => {
				if (creep.memory.singleRoom && creep.memory.singleRoom === room.name) return true;

				if (!creep.shard) return false;
				if (creep.shard !== Game.shard.name) return false;
				if (creep.pos.roomName !== room.name) return false;

				return true;
			});

			if (_.size(powerCreepsInRoom) > 0) return false;

			return true;
		});

		const bestRoom = _.max(roomsWithoutPC, room => {
			if (!Memory.strategy) return 0;
			if (!Memory.strategy.roomList) return 0;
			if (!Memory.strategy.roomList[room.name]) return 0;

			return Memory.strategy.roomList[room.name].expansionScore || 0;
		});

		if (!bestRoom) return;

		creep.memory.singleRoom = bestRoom.name;
	}
};
