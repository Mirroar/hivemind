import container from 'utils/container';
import RoomStatus from 'room/room-status';
import settings from 'settings-manager';
import {getAllSquads} from 'manager.squad';
import {getRoomIntel} from 'room-intel';

interface HarvestRoomInfo {
	roomName: string;
	origin: string;
	harvestPriority: number;
}

type SourceRoomAvailability = {
	current: number;
	max: number;
};

export default class RemoteMinePrioritizer {
	roomStatus: RoomStatus;

	constructor() {
		this.roomStatus = container.get('RoomStatus');
	}

	getRoomsToMine(maxAmount: number): {rooms: string[]; maxRooms: number} {
		const result: string[] = [];
		const sourceRooms = this.getRemoteMiningSourceRooms();

		// Create ordered list of best harvest rooms.
		// @todo At this point we should carry duplicate for rooms that could have
		// multiple origins.
		const sortedHarvestRooms = _.sortBy(this.getRemoteHarvestRooms(sourceRooms), (info: HarvestRoomInfo) => {
			// Rooms that don't have a terminal yet need remotes to get enough
			// energy to upgrade and build one.
			const originHasTerminal = Game.rooms[info.origin]?.terminal;

			return -info.harvestPriority * (originHasTerminal ? 1 : 1.5);
		});

		// Decide which harvest rooms are active.
		let availableHarvestRoomCount = 0;
		for (const info of sortedHarvestRooms) {
			if (sourceRooms[info.origin].current >= sourceRooms[info.origin].max) continue;

			const roomIntel = getRoomIntel(info.roomName);
			if (
				roomIntel.isSourceKeeperRoom()
				&& _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0
				&& (Game.rooms[info.origin]?.controller?.level || 0) < 7
			) {
				// Can't harvest source keeper rooms if we can't spawn a strong
				// enough SK killer.
				continue;
			}

			sourceRooms[info.origin].current++;

			if (availableHarvestRoomCount < maxAmount) {
				// Disregard rooms the user doesn't want harvested.
				const roomFilter = settings.get('remoteMineRoomFilter');
				if (roomFilter && !roomFilter(info.roomName)) continue;

				// Harvest from this room.
				result.push(info.roomName);
			}

			availableHarvestRoomCount++;
		}

		return {
			rooms: result,
			maxRooms: availableHarvestRoomCount,
		};
	}

	getRemoteMiningSourceRooms(): Record<string, SourceRoomAvailability> {
		const sourceRooms: Record<string, SourceRoomAvailability> = {};

		// Determine how much remote mining each room can handle.
		for (const room of Game.myRooms) {
			let spawnCount = _.filter(Game.spawns, spawn => spawn.pos.roomName === room.name && spawn.isOperational()).length;
			if (spawnCount === 0) {
				if (room.controller.level > 3 && room.controller.level < 7) {
					// It's possible we're only moving the room's only spawn to a different
					// location. Treat room as having one spawn so we can resume when it
					// has been rebuilt.
					spawnCount = 1;
				}
				else {
					continue;
				}
			}

			// @todo Actually calculate spawn usage for each.
			let spawnCapacity = spawnCount * 5;
			let roomNeeds = 0;
			if (room.controller.level >= 4) roomNeeds++;
			if (room.controller.level >= 6) roomNeeds++;
			roomNeeds += _.filter(getAllSquads(), squad => squad.getSpawn() === room.name).length;

			// Increase spawn capacity if there's a power creep that can help.
			const powerCreep = _.find(Game.powerCreeps, creep => {
				if (!creep.shard) return false;
				if (creep.shard !== Game.shard.name) return false;
				if (creep.pos.roomName !== room.name) return false;

				return true;
			});
			if (powerCreep) {
				const operateSpawnLevel = (powerCreep.powers[PWR_OPERATE_SPAWN] || {}).level || 0;
				if (operateSpawnLevel > 0) spawnCapacity /= POWER_INFO[PWR_OPERATE_SPAWN].effect[operateSpawnLevel - 1];
			}

			sourceRooms[room.name] = {
				current: 0,
				max: Math.floor(spawnCapacity - roomNeeds),
			};
		}

		return sourceRooms;
	}

	getRemoteHarvestRooms(sourceRooms: Record<string, SourceRoomAvailability>): HarvestRoomInfo[] {
		const harvestRooms: HarvestRoomInfo[] = [];
		for (const roomName of this.roomStatus.getAllKnownRooms()) {
			if (Game.rooms[roomName]?.isMine()) continue;

			// Ignore rooms that are not profitable to harvest from.
			const harvestPriority = this.roomStatus.getHarvestPriority(roomName);
			if (harvestPriority <= 0.1) continue;

			const origin = this.roomStatus.getOrigin(roomName);
			if (!sourceRooms[origin]) continue;

			// @TODO: Include SK room filter here.
			// const roomIntel = getRoomIntel(roomName);
			// if (roomIntel.isSourceKeeperRoom() && _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) return;

			harvestRooms.push({roomName, origin, harvestPriority});
		}

		return harvestRooms;
	}
}
