/* global RoomPosition FIND_STRUCTURES STRUCTURE_POWER_BANK OK
POWER_BANK_DECAY FIND_MY_CREEPS HEAL_POWER RANGED_HEAL_POWER HEAL
FIND_DROPPED_RESOURCES RESOURCE_POWER FIND_HOSTILE_CREEPS RANGED_ATTACK
POWER_BANK_HIT_BACK */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import Role from 'role/role';
import {isCrossroads} from 'utils/room-name';

declare global {
	interface CaravanTraderCreep extends Creep {
		memory: CaravanTraderCreepMemory;
		heapMemory: CaravanTraderCreepHeapMemory;
	}

	interface CaravanTraderCreepMemory extends CreepMemory {
		role: 'caravan-trader';
		resourceType: ResourceConstant;
		origin: string;
		target: string;
		delivering: boolean;
		returning?: boolean;
	}

	interface CaravanTraderCreepHeapMemory extends CreepHeapMemory {
		targetRoom?: string;
	}
}

export default class CaravanTraderRole extends Role {
	constructor() {
		super();

		// Caravan traders have high priority because they are needed to score.
		this.stopAt = 1000;
		this.throttleAt = 3000;
	}

	/**
	 * Makes a creep act like a power harvester.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: CaravanTraderCreep) {
		if (creep.memory.returning) {
			this.performReturn(creep);
			return;
		}

		if (!creep.memory.delivering) {
			this.performPickup(creep);
		}

		if (creep.memory.delivering) {
			this.performDeliver(creep);
		}
	}

	performReturn(creep: CaravanTraderCreep) {
		const targetPos = new RoomPosition(25, 25, creep.memory.origin);
		if (creep.interRoomTravel(targetPos)) return;
		if (creep.pos.roomName !== creep.memory.origin) return;

		if (!creep.room.isMine()) {
			this.performRecycle(creep);
			return;
		}

		if (creep.store.getUsedCapacity() === 0) {
			this.performRecycle(creep);
			return;
		}

		const resourceType = creep.memory.resourceType;
		const target = creep.room.getBestStorageTarget(creep.store.getUsedCapacity(resourceType), resourceType);
		if (!target) {
			this.performRecycle(creep);
			return;
		}

		creep.whenInRange(1, target, () => {
			creep.transferAny(target);
			hivemind.log('creeps', creep.room.name).notify(creep.name, 'emptying inventory:', JSON.stringify(creep.store));
		});
	}

	performPickup(creep: CaravanTraderCreep) {
		const resourceType = creep.memory.resourceType;
		const source = creep.room.getBestStorageSource(resourceType);
		if (!source || source.store.getUsedCapacity(resourceType) === 0) {
			creep.memory.delivering = true;
			return;
		}

		const info = Memory.strategy.caravans[creep.memory.target];
		const neededAmount = 1000 - info.contents[resourceType];

		if (creep.store.getUsedCapacity(resourceType) >= neededAmount) {
			creep.memory.delivering = true;
			return;
		}

		creep.whenInRange(1, source, () => {
			const amount = Math.min(1000, neededAmount - creep.store.getUsedCapacity(resourceType), source.store.getUsedCapacity(resourceType));
			creep.withdraw(source, resourceType, amount);
			hivemind.log('creeps', creep.room.name).notify(creep.name + ' took ' + amount + ' ' + resourceType + '.');
			if (amount + creep.store.getUsedCapacity(resourceType) >= neededAmount) creep.memory.delivering = true;
		});
	}

	performDeliver(creep: CaravanTraderCreep) {
		if (!creep.heapMemory.targetRoom) this.chooseTargetRoom(creep);
		if (!creep.heapMemory.targetRoom) return;

		const targetPos = new RoomPosition(25, 25, creep.heapMemory.targetRoom);
		if (creep.interRoomTravel(targetPos)) return;
		if (creep.pos.roomName !== creep.heapMemory.targetRoom) return;

		const caravanCreeps = _.filter(creep.room.enemyCreeps[SYSTEM_USERNAME] || [], c => c.name.startsWith(creep.memory.target));
		if (caravanCreeps.length === 0) {
			// 404, caravan not found. Look in other rooms.
			this.chooseFollowUpRoom(creep);
			return;
		}

		const resourceType = creep.memory.resourceType;
		const ourTarget = _.find(caravanCreeps, c => c.store.getUsedCapacity(resourceType) > 0);

		if (!ourTarget || ourTarget.store.getFreeCapacity() === 0) {
			// @todo Maybe our specific creep is just in the next room.
			creep.memory.returning = true;
			return;
		}

		creep.whenInRange(1, ourTarget, () => {
			if (creep.transfer(ourTarget, resourceType) === OK) {
				hivemind.log('creeps', creep.room.name).notify(creep.name + ' scored ' + Math.min(creep.store.getUsedCapacity(resourceType), ourTarget.store.getFreeCapacity(resourceType)) + ' ' + resourceType + '.');
				creep.memory.returning = true;
			}
		});
	}

	chooseTargetRoom(creep: CaravanTraderCreep) {
		// Go to first caravan room that we can reach in time.
		if (!hivemind.segmentMemory.isReady()) return;

		const mesh = new NavMesh();
		const sourcePos = creep.pos;
		const caravanInfo = Memory.strategy.caravans[creep.memory.target];
		if (!caravanInfo) {
			creep.memory.returning = true;
			return;
		}

		for (const target of caravanInfo.rooms) {
			const targetPosition = new RoomPosition(25, 25, target.name);
			const travelTime = mesh.estimateTravelTime(sourcePos, targetPosition);
			if (!travelTime) continue;

			if (Game.time + travelTime < target.time + (isCrossroads(target.name) ? 50 : 100)) {
				creep.heapMemory.targetRoom = target.name;
				return;
			}
		}

		// No rooms seem to be in range.
		creep.memory.returning = true;
	}

	chooseFollowUpRoom(creep: CaravanTraderCreep) {
		// Go to room the caravan is supposed to be in.
		if (!hivemind.segmentMemory.isReady()) return;

		const caravanInfo = Memory.strategy.caravans[creep.memory.target];
		if (!caravanInfo) {
			creep.memory.returning = true;
			return;
		}

		for (let i = 0; i < caravanInfo.rooms.length; i++) {
			const target = caravanInfo.rooms[i];
			if (target.name !== creep.pos.roomName) continue;

			if (i > 0) {
				creep.heapMemory.targetRoom = caravanInfo.rooms[i - 1].name;
			}
			else if (caravanInfo.rooms.length > 0) {
				creep.heapMemory.targetRoom = caravanInfo.rooms[1].name;
			}
		}

		// We are not in a room on the caravan's path. Try to catch up.
		creep.heapMemory.targetRoom = caravanInfo.rooms[0].name;
	}
}
