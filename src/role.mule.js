'use strict';

/* global FIND_STRUCTURES FIND_RUINS FIND_DROPPED_RESOURCES FIND_TOMBSTONES
STRUCTURE_STORAGE STRUCTURE_TERMINAL FIND_SYMBOL_CONTAINERS */

const Role = require('./role');
const TradeRoute = require('./trade-route');
const utilities = require('./utilities');

/**
 * Mules follow trade routes and transport resources accordingly.
 *
 * Memory structure:
 * - origin: Name of the room the creep originates in.
 * - route: Name of the trade route this mule works for.
 */
module.exports = class MuleRole extends Role {
	/**
	 * Creates a new GathererRole object.
	 */
	constructor() {
		super();
	}

	/**
	 * Makes this creep behave like a gatherer.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		// @todo Make TradeRoute object available and reusable.
		this.tradeRoute = new TradeRoute(creep.memory.route);

		if (!this.tradeRoute.isActive()) {
			this.setDelivering(creep, false);
		}

		if (creep.memory.delivering) {
			this.deliverResources(creep);
			return;
		}

		this.pickupResources(creep);
	}

	setDelivering(creep, deliver) {
		creep.memory.delivering = deliver;
		const prevIndex = creep.memory.pathIndex;
		this.setRoomPath(creep, deliver ? this.tradeRoute.getPath() : this.tradeRoute.getReversePath());
		if (prevIndex) creep.memory.pathIndex = creep.memory.roomPath.length - prevIndex - 1;
	}

	setRoomPath(creep, path) {
		creep.memory.roomPath = path;
		delete creep.memory.pathIndex;
	}

	followRoomPath(creep) {
		const inRoom = (creep.pos.x > 2 && creep.pos.x < 47 && creep.pos.y > 2 && creep.pos.y < 47);
		// @todo Find room in path that we're closest to.
		if (!creep.memory.pathIndex) creep.memory.pathIndex = 0;

		const nextRoom = creep.memory.roomPath[creep.memory.pathIndex];
		if (!nextRoom) return false;

		if (creep.pos.roomName === nextRoom && inRoom) creep.memory.pathIndex++;

		// Move to next room.
		const target = new RoomPosition(25, 25, nextRoom);
		if (creep.pos.getRangeTo(target) > 15) {
			return creep.moveToRange(target, 15);
		}
	}

	/**
	 * Makes the creep move into the target room and gather resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	pickupResources(creep) {
		const originRoom = this.tradeRoute.getOrigin();
		if (creep.pos.roomName !== originRoom) {
			// Move back to spawn room.
			// @todo Use reverse path from trade route.
			this.followRoomPath(creep);
			return;
		}

		if (!this.tradeRoute.isActive()) {
			if (creep.store.getUsedCapacity() > 0) {
				// Choose a resource and deliver it.
				_.each(creep.store, (amount, resourceType) => {
					if (!amount || amount === 0) return;

					const target = creep.room.getBestStorageTarget(amount, resourceType);
					if (!target) return false;

					if (creep.pos.getRangeTo(target) > 1) {
						creep.moveToRange(target, 1);
						return false;
					}

					creep.transfer(target, resourceType);
					return false;
				});
				return;
			}

			// Wait for trade route to be active again.
			creep.moveToRange(new RoomPosition(25, 25, creep.room.name), 10);
			return;
		}

		// Switch to delivery mode if storage is full.
		if (creep.store.getFreeCapacity() === 0) {
			this.setDelivering(creep, true);
			if (!this.tradeRoute.hasTravelLength()) {
				creep.memory.recordTravelLength = Game.time;
			}
			return;
		}

		// Choose a target in the room.
		// @todo Cache it.
		const resourceType = this.tradeRoute.getResourceType();
		const target = creep.room.getBestStorageSource(resourceType);
		if (!target && !creep.memory.delivering) {
			if (creep.store.getUsedCapacity() * 2 > creep.store.getFreeCapacity()) {
				// Deliver what resources we gathered.
				this.setDelivering(creep, true);
				return;
			}

			// Wait for more.
			creep.moveToRange(new RoomPosition(25, 25, creep.room.name), 10);
			return;
		}

		if (target) {
			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
				return;
			}

			creep.withdraw(target, resourceType);
		}
	}

	/**
	 * Makes the creep return to the spawn room and deliver resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	deliverResources(creep) {
		const targetRoom = this.tradeRoute.getTarget();
		if (creep.pos.roomName !== targetRoom) {
			// Move back to spawn room.
			// @todo Use reverse path from trade route.
			this.followRoomPath(creep);
			return;
		}

		// Choose a resource and deliver it.
		const resourceType = this.tradeRoute.getResourceType();
		const amount = creep.store[resourceType] || 0;

		const target = creep.room.decoder;
		if (!target) return;

		if (creep.pos.getRangeTo(target) > 1) {
			creep.goTo(target, {range: 1, maxRooms: 1});
			return;
		}

		creep.transfer(target, resourceType);
		Game.notify(creep.memory.route + ': Transferred ' + (creep.store[resourceType] || 0) + ' ' + resourceType + ' to ' + creep.room.name);

		if (creep.memory.recordTravelLength) {
			this.tradeRoute.setTravelLength(Game.time - creep.memory.recordTravelLength);
			delete creep.memory.recordTravelLength;
		}

		if (creep.store.getUsedCapacity() === 0) {
			this.setDelivering(creep, false);

			// Suicide if another round is unlikely to succeed in time.
			const travelLength = this.tradeRoute.getTravelLength();
			if (travelLength && creep.ticksToLive < 2.1 * travelLength) creep.suicide();
		}
	}
};
