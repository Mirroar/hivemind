import Role from 'role/role';

export default class GiftRole extends Role {
	/**
	 * Makes this creep take excess resources from storage.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		if (creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.95) {
			// If we're (nearly) full, embark.
			this.performGiftTransport(creep);
			return;
		}

		const storage = creep.room.storage;
		if (!storage) {
			// Nothing to gift if we have no storage.
			this.performGiftTransport(creep);
			return;
		}

		if (!creep.memory.targetResource) {
			this.chooseGiftResource(creep);
			return;
		}

		if (!storage.store[creep.memory.targetResource] || storage.store[creep.memory.targetResource] <= 0) {
			this.chooseGiftResource(creep);
			return;
		}

		if (creep.pos.getRangeTo(storage) > 1) {
			creep.moveToRange(storage, 1);
			return;
		}

		creep.withdraw(storage, creep.memory.targetResource);
		delete creep.memory.targetResource;

		// Do not send notifications when attacked - we mean to suicide.
		creep.notifyWhenAttacked(false);
	}

	/**
	 * Chooses a resource the room is overly full on.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	chooseGiftResource(creep) {
		let tryCount = 0;
		let resourceType = null;
		const resourceTypes = Object.keys(creep.room.storage.store);
		do {
			resourceType = _.sample(resourceTypes);
			tryCount++;
		} while (tryCount < 10 && !creep.room.isFullOn(resourceType));

		creep.memory.targetResource = resourceType;
	}

	/**
	 * Move the creep out of the room by letting it scout.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performGiftTransport(creep) {
		// @todo Move to a nearby owned room with enough space left.
		// @todo Move to a known enemy room and suicide.
		if (!creep.heapMemory.targetRoom) {
			creep.heapMemory.targetRoom = _.sample(Game.map.describeExits(creep.room.name));
		}

		creep.moveToRange(new RoomPosition(25, 25, creep.heapMemory.targetRoom), 20);

		if (creep.memory.origin && creep.pos.roomName !== creep.memory.origin && creep.isInRoom()) {
			// We're outside of our origin room. Suicide to get rid of resource and save
			// CPU.
			creep.suicide();
		}
	}
}
