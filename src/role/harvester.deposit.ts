/* global RoomPosition FIND_STRUCTURES STRUCTURE_POWER_BANK OK
POWER_BANK_DECAY FIND_MY_CREEPS HEAL_POWER RANGED_HEAL_POWER HEAL
FIND_DROPPED_RESOURCES RESOURCE_POWER FIND_HOSTILE_CREEPS RANGED_ATTACK
POWER_BANK_HIT_BACK */

declare global {
	interface DepositHarvesterCreep extends Creep {
		memory: DepositHarvesterCreepMemory;
		heapMemory: DepositHarvesterCreepHeapMemory;
	}

	interface DepositHarvesterCreepMemory extends CreepMemory {
		role: 'harvester.deposit';
		targetPos: string;
		origin: string;
		delivering: boolean;
	}

	interface DepositHarvesterCreepHeapMemory extends CreepHeapMemory {
		returnTravelTime?: number;
	}
}

import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import Role from 'role/role';
import utilities from 'utilities';
import {deserializePosition} from 'utils/serialization';

export default class DepositHarvesterRole extends Role {
	constructor() {
		super();

		// Deposit harvesters have high priority because they need to harvest in the same tick.
		this.stopAt = 1000;
		this.throttleAt = 3000;
	}

	/**
	 * Makes a creep act like a power harvester.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: DepositHarvesterCreep) {
		// @todo Return / suicide when TTL gets low.
		// @todo transfer to adjacent creeps to send only one home?

		const targetPosition = deserializePosition(creep.memory.targetPos);
		if (creep.memory.delivering && creep.store.getUsedCapacity() === 0) {
			if (creep.ticksToLive <= 2.5 * this.getReturnTravelTime(creep)) {
				// Round trip plus harvesting is not realistic with this little time.
				// @todo Go to a spawn to recycle if possible.
				creep.suicide();
				return;
			}

			this.setDelivering(creep, false);
		}
		else if (!creep.memory.delivering && creep.store.getUsedCapacity() > creep.store.getCapacity() * 0.95) {
			this.setDelivering(creep, true);
		}
		else if (!creep.memory.delivering && creep.pos.roomName == targetPosition.roomName && creep.pos.getRangeTo(targetPosition) < 3 && creep.ticksToLive <= 1.1 * this.getReturnTravelTime(creep)) {
			this.setDelivering(creep, true);
		}

		if (creep.memory.delivering) {
			this.performDeliver(creep);
			return;
		}

		this.performDepositHarvesting(creep);
	}

	setDelivering(creep: DepositHarvesterCreep, delivering: boolean) {
		creep.memory.delivering = delivering;
	}

	getReturnTravelTime(creep: DepositHarvesterCreep): number {
		if (creep.heapMemory.returnTravelTime) return creep.heapMemory.returnTravelTime;

		creep.heapMemory.returnTravelTime = cache.inHeap('returnTravel:' + creep.memory.targetPos + ':' + creep.memory.origin, 10000, () => {
			const mesh = new NavMesh();
			const targetPosition = deserializePosition(creep.memory.targetPos);
			const path = mesh.findPath(targetPosition, new RoomPosition(25, 25, creep.memory.origin));
			if (path.incomplete) {
				creep.heapMemory.returnTravelTime = Game.map.getRoomLinearDistance(creep.pos.roomName, creep.memory.origin) * 75;
				return creep.heapMemory.returnTravelTime || 0;
			}

			let prevWaypoint = targetPosition;
			let total = 0;
			for (const waypoint of path.path) {
				const subPath = PathFinder.search(prevWaypoint, waypoint, {
					maxRooms: 3,
					roomCallback: roomName => utilities.getCostMatrix(roomName),
				});

				if (subPath.incomplete) total += 75
				else total += subPath.path.length;
			}

			return total;
		});

		return creep.heapMemory.returnTravelTime || 0;
	}

	performDeliver(creep: DepositHarvesterCreep) {
		const origin = creep.memory.origin;
		if (!Game.rooms[origin] || !Game.rooms[origin].isMine()) {
			// @todo Choose a new room close by and deliver.
			return;
		}

		const targetPosition = Game.rooms[origin].getStorageLocation();
		if (creep.interRoomTravel(targetPosition)) return;
		if (creep.pos.roomName != targetPosition.roomName) return;

		let resourceType: string;
		for (const contentType in creep.store) {
			if (creep.store.getUsedCapacity(contentType as ResourceConstant) > 0) {
				resourceType = contentType;
				break;
			}
		}

		const target = creep.room.getBestStorageTarget(creep.store.getUsedCapacity(), resourceType);
		creep.whenInRange(1, target, () => {
			creep.transferAny(target);
		});
	}

	performDepositHarvesting(creep: DepositHarvesterCreep) {
		const targetPosition = deserializePosition(creep.memory.targetPos);
		if (creep.interRoomTravel(targetPosition)) return;
		if (creep.pos.roomName != targetPosition.roomName) return;

		const deposits = targetPosition.lookFor(LOOK_DEPOSITS);

		if (deposits.length === 0) {
			this.setDelivering(creep, true);
			return;
		}

		creep.whenInRange(1, deposits[0], () => {
			creep.harvest(deposits[0]);
		});
	}
}
