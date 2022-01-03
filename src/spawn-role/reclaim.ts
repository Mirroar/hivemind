import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';

export default class ReclaimSpawnRole extends SpawnRole {

	navMesh?: NavMesh;
	spawnOptions: {
		priority: number,
		weight: number,
		targetRoom: string,
	}[];
	room: Room;

	/**
	 * Adds reclaim spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room: Room, options) {
		if (!hivemind.segmentMemory.isReady()) return;

		this.spawnOptions = options;
		this.room = room;
		for (const targetRoom of Game.myRooms) {
			if (room.name === targetRoom.name) continue;
			this.addSpawnOptionsFor(targetRoom);
		}
	}

	addSpawnOptionsFor(targetRoom: Room) {
		if (!this.canReclaimRoom(targetRoom)) return;

		this.spawnOptions.push({
			priority: 3,
			weight: 1,
			targetRoom: targetRoom.name,
		});
	}

	canReclaimRoom(targetRoom: Room): boolean {
		if (!targetRoom.memory.isReclaimableSince) return false;
		if (Game.time - targetRoom.memory.isReclaimableSince < 2000) return false;

		const remoteBuilderCount = _.filter(Game.creepsByRole['builder.remote'], (creep: RemoteBuilderCreep) => creep.memory.targetRoom === targetRoom.name || creep.memory.singleRoom === targetRoom.name).length;
		if (remoteBuilderCount > 5) return false;

		const route = cache.inHeap('reclaimPath:' + targetRoom.name + '.' +  this.room.name, 100, () => {
			if (!this.navMesh) this.navMesh = new NavMesh();
			return this.navMesh.findPath(this.room.roomPlanner.getRoomCenter(), targetRoom.roomPlanner.getRoomCenter(), {maxPathLength: 700});
		});
		if (route.incomplete) return false;

		return true;
	}

	/**
	 * Gets the body of a creep to be spawned.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {string[]}
	 *   A list of body parts the new creep should consist of.
	 */
	getCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [CARRY]: 0.28, [WORK]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	/**
	 * Gets memory for a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepMemory(room, option) {
		return {
			role: 'builder.remote',
			targetRoom: option.targetRoom,
		};
	}
};
