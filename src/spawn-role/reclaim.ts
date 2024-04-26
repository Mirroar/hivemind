import BodyBuilder from 'creep/body-builder';
import cache from 'utils/cache';
import hivemind from 'hivemind';
import interShard from 'intershard';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';
import {decodePosition} from 'utils/serialization';

interface ReclaimSpawnOption extends SpawnOption {
	targetRoom: string;
	interShardPortal?: string;
}

export default class ReclaimSpawnRole extends SpawnRole {
	navMesh?: NavMesh;
	room: Room;

	/**
	 * Adds reclaim spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): ReclaimSpawnOption[] {
		if (!hivemind.segmentMemory.isReady()) return [];

		return this.cacheEmptySpawnOptionsFor(room, 100, () => {
			if (room.getEffectiveAvailableEnergy() < 10_000) return [];

			const options: ReclaimSpawnOption[] = [];
			this.room = room;
			for (const targetRoom of Game.myRooms) {
				if (room.name === targetRoom.name) continue;
				this.addSpawnOptionsFor(targetRoom, options);
			}

			this.addIntershardSpawnOptions(options);

			return options;
		});
	}

	addSpawnOptionsFor(targetRoom: Room, options: ReclaimSpawnOption[]) {
		if (!this.canReclaimRoom(targetRoom)) return;

		options.push({
			priority: 3,
			weight: 1,
			targetRoom: targetRoom.name,
		});
	}

	canReclaimRoom(targetRoom: Room): boolean {
		if (!targetRoom.needsReclaiming()) return false;
		if (!targetRoom.isSafeForReclaiming()) return false;
		if (!targetRoom.roomPlanner) return false;

		const remoteBuilderCount = _.filter(Game.creepsByRole['builder.remote'], (creep: RemoteBuilderCreep) => creep.memory.targetRoom === targetRoom.name || creep.memory.singleRoom === targetRoom.name).length;
		if (remoteBuilderCount > 5) return false;

		const route = cache.inHeap('reclaimPath:' + targetRoom.name + '.' + this.room.name, 100, () => {
			if (!this.navMesh) this.navMesh = new NavMesh();
			return this.navMesh.findPath(this.room.roomPlanner.getRoomCenter(), targetRoom.roomPlanner.getRoomCenter(), {maxPathLength: 700});
		});
		if (route.incomplete) return false;

		return true;
	}

	addIntershardSpawnOptions(options: ReclaimSpawnOption[]) {
		const interShardMemory = interShard.getLocalMemory();
		for (const shardName in (interShardMemory.portals || {})) {
			const shardMemory = interShard.getRemoteMemory(shardName);
			if (!shardMemory?.info?.rooms?.reclaimable) continue;

			for (const request of shardMemory.info.rooms.reclaimable) {
				this.addIntershardSpawnOptionsFor(request, shardName, options);
			}
		}
	}

	addIntershardSpawnOptionsFor(request: {name: string; safe: boolean; rcl: number; portalRoom?: string}, shardName: string, options: ReclaimSpawnOption[]) {
		if (!request.portalRoom) return;
		if (request.rcl < 4) return;
		if (!request.safe) return;

		const remoteBuilderCount = _.filter(Game.creepsByRole['builder.remote'], (creep: RemoteBuilderCreep) => creep.memory.targetRoom === request.name && creep.memory.interShardPortal).length;
		if (remoteBuilderCount > 5) return;

		const portalLocation = this.findClosestPortalToRemoteRoom(request.portalRoom, shardName);
		if (!portalLocation) return;

		options.push({
			priority: 3,
			weight: 1,
			targetRoom: request.name,
			interShardPortal: portalLocation,
		});
	}

	findClosestPortalToRemoteRoom(roomName: string, shardName: string) {
		return cache.inHeap('portalRoomPos:' + this.room.name + ':' + roomName + ':' + shardName, 2 * CREEP_LIFE_TIME, () => {
			let bestPortal;

			console.log('Checking if we can spawn a reclaimer to ' + shardName + '/' + roomName);

			const interShardMemory = interShard.getLocalMemory();
			_.each(interShardMemory.portals[shardName], (portalInfo, portalLocation) => {
				if (portalInfo.dest !== roomName) return;

				const portalPosition = decodePosition(portalLocation);
				if (Game.map.getRoomLinearDistance(portalPosition.roomName, this.room.name) > 10) return;

				console.log('Checking if we can reach ' + shardName + '/' + roomName + ' from portal at ' + portalPosition + '...');

				if (!this.navMesh) this.navMesh = new NavMesh();
				const path = this.navMesh.findPath(portalPosition, new RoomPosition(25, 25, this.room.name), {maxPathLength: 700});
				console.log(path.incomplete ? 'incomplete' : path.path.length);
				if (!path || path.incomplete) return;

				if (bestPortal && bestPortal.range <= path.path.length) return;

				bestPortal = {
					portalLocation,
					range: path.path.length,
				};
			});

			return bestPortal?.portalLocation;
		});
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
	getCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[CARRY]: 3, [WORK]: 2})
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
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
	getCreepMemory(room: Room, option: ReclaimSpawnOption): RemoteBuilderCreepMemory {
		const memory: RemoteBuilderCreepMemory = {
			role: 'builder.remote',
			targetRoom: option.targetRoom,
		};

		if (option.interShardPortal) {
			memory.interShardPortal = option.interShardPortal;
		}

		return memory;
	}
}
