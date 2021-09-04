import Role from 'role/role';
import ScoutRole from 'role/scout';

export default class GiftRole extends Role {
	scoutRole: ScoutRole;

	constructor() {
		super();
		this.scoutRole = new ScoutRole();
	}

	/**
	 * Makes this creep take excess resources from storage.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		if (_.sum(creep.carry) >= creep.carryCapacity * 0.95) {
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
		// Do not send notifications when attacked - we mean to suicide.
		creep.notifyWhenAttacked(false);

		// @todo Move to a nearby owned room with enough space left.
		// @todo Move to a known enemy room and suicide.
		this.scoutRole.run(creep);

		if (creep.memory.origin && creep.pos.roomName !== creep.memory.origin && creep.isInRoom()) {
			// We're outside of our origin room. Suicide to get rid of resource and save
			// CPU.
			creep.suicide();
		}
	}
}
