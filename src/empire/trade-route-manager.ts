import {ENEMY_STRENGTH_NONE} from 'room-defense';
import ResourceLevelManager from 'room/resource-level-manager';
import cache from 'utils/cache';
import {timeCall} from 'utils/cpu';
import {getResourcesIn} from 'utils/store';

export interface TransportRouteOption {
	priority: number;
	weight: number;
	resourceType: ResourceConstant;
	source: string;
	target: string;
}

export default class TradeRouteManager {
	resourceLevelManager: ResourceLevelManager;

	constructor(resourceLevelManager: ResourceLevelManager) {
		this.resourceLevelManager = resourceLevelManager;
	}

	/**
	 * Determines when it makes sense to transport resources between rooms.
	 *
	 * @return {Array}
	 *   An array of option objects with priorities.
	 */
	public getAvailableTransportRoutes(): TransportRouteOption[] {
		const options = [];
		const rooms: Record<string, RoomResourceState> = this.getResourceStates();
		
		_.each(rooms, (roomState: RoomResourceState, roomName: string) => {
			const room = Game.rooms[roomName];
			if (!roomState.canTrade) return;

			const needsTerminalSpace = this.roomNeedsTerminalSpace(room);
			const needsStorageSpace = this.roomNeedsStorageSpace(room);

			// Do not try transferring from a room that is already preparing a transfer.
			if (room.memory.fillTerminal && !needsTerminalSpace && !needsStorageSpace) return;

			if (room.terminal.cooldown) return;

			for (const resourceType of getResourcesIn(roomState.state)) {
				if (!roomState.totalResources[resourceType]) continue;

				const resourceLevel = roomState.state[resourceType] || 'low';

				this.addResourceRequestOptions(options, room, resourceType, roomState);

				if (
					resourceLevel !== 'high'
					&& resourceLevel !== 'excessive'
					&& !needsTerminalSpace
				) continue;

				// Make sure we have enough to send (while evacuating).
				if (needsTerminalSpace && (roomState.totalResources[resourceType] || 0) < 100) continue;
				if (resourceType === RESOURCE_ENERGY && (roomState.totalResources[resourceType] || 0) < 10_000) continue;

				// Look for other rooms that are low on this resource.
				_.each(rooms, (roomState2: any, roomName2: string) => {
					if (roomName === roomName2) return;
					if (!roomState2.canTrade) return;

					const room2 = Game.rooms[roomName2];
					
					// Make sure target has space left.
					if (room2.terminal.store.getFreeCapacity() < 5000) return;

					if (resourceType === RESOURCE_ENERGY && this.roomNeedsTerminalSpace(room2) && !this.isEvacuatingRoomWithLowEnergy(room2)) return;

					const resourceLevel2 = roomState2.state[resourceType] || this.resourceLevelManager.determineResourceLevel(room2, roomState2.totalResources[resourceType] || 0, resourceType);
					const isLow = resourceLevel2 === 'low'
						|| (resourceType === RESOURCE_ENERGY && room2.defense.getEnemyStrength() > ENEMY_STRENGTH_NONE && resourceLevel2 === 'medium');
					const isLowEnough = resourceLevel2 === 'medium';
					const shouldReceiveResources = isLow
						|| (resourceLevel === 'excessive' && isLowEnough);

					if (!needsTerminalSpace && !needsStorageSpace && !shouldReceiveResources) return;

					// Make sure source room has enough energy to send resources.
					const neededEnergy = Game.market.calcTransactionCost(5000, roomName, roomName2) + (resourceType === RESOURCE_ENERGY ? 5000 : 0);
					if (room.terminal.store.energy < neededEnergy) return;

					const option = {
						priority: 3,
						weight: (((roomState.totalResources[resourceType] || 0) - (roomState2.totalResources[resourceType] || 0)) / 100_000) - Game.map.getRoomLinearDistance(roomName, roomName2),
						resourceType,
						source: roomName,
						target: roomName2,
					};

					if (needsTerminalSpace && resourceType !== RESOURCE_ENERGY) {
						option.priority++;
						if (room.terminal.store[resourceType] && room.terminal.store[resourceType] >= 5000) {
							option.priority++;
						}
					}
					else if (!isLow) {
						option.priority--;
					}

					options.push(option);
				});
			}
		});

		return options;
	}

	private addResourceRequestOptions(options: TransportRouteOption[], room: Room, resourceType: ResourceConstant, roomState: RoomResourceState) {
		// Fullfill allies trade requests.
		for (const roomName2 in Memory?.requests?.trade?.[resourceType] || {}) {
			const info = Memory.requests.trade[resourceType][roomName2];
			if (Game.time - info.lastSeen > 10) {
				// Request was not recorded recently, skip it.
				continue;
			}

			const tier = this.getResourceTier(resourceType);
			const shouldReceiveResources
				= roomState.state[resourceType] === 'excessive' && info.priority >= 0.05
				|| roomState.state[resourceType] === 'high' && (info.priority >= 0.5 || tier > 1)
				|| roomState.state[resourceType] === 'medium' && (info.priority >= 0.8)
				|| roomState.state[resourceType] === 'medium' && (info.priority >= 0.5 && tier > 1)
				|| roomState.state[resourceType] === 'low' && (info.priority >= 0.8 && tier > 1)
				|| roomState.state[resourceType] === 'low' && (info.priority >= 0.5 && tier > 4);
			if (!shouldReceiveResources) continue;

			// Make sure source room has enough energy to send resources.
			const amount = Math.min(roomState.totalResources[resourceType] || 0, 5000);
			if (amount < 100) continue;
			if (room.terminal.store.energy < Game.market.calcTransactionCost(5000, room.name, roomName2)) continue;

			const option = {
				priority: 3,
				weight: (roomState.totalResources[resourceType] / 100_000) - Game.map.getRoomLinearDistance(room.name, roomName2),
				resourceType,
				source: room.name,
				target: roomName2,
			};

			if (this.roomNeedsTerminalSpace(room) && resourceType !== RESOURCE_ENERGY) {
				option.priority++;
				if (room.terminal.store[resourceType] && room.terminal.store[resourceType] >= 5000) {
					option.priority++;
				}
			}
			else if (info.priority < 0.5) {
				option.priority--;
			}

			options.push(option);
		}
	}

	private getResourceTier(resourceType: ResourceConstant): number {
		if (resourceType === RESOURCE_ENERGY) return 0;
		if (resourceType === RESOURCE_POWER) return 10;

		const tier = resourceType.length;
		if (resourceType.includes('G')) {
			return tier + 3;
		}

		return tier;
	}

	/**
	 * Collects resource states of all available rooms.
	 *
	 * @return {object}
	 *   Resource states, keyed by room name.
	 */
	private getResourceStates(): Record<string, RoomResourceState> {
		const rooms = {};

		// Collect room resource states.
		for (const room of Game.myRooms) {
			const roomData = room.getResourceState();
			if (!roomData) continue;

			rooms[room.name] = roomData;
		}

		return rooms;
	}

	public roomNeedsTerminalSpace(room: Room): boolean {
		return cache.inObject(room, 'roomNeedsTerminalSpace', 1, () => {
			return room.isEvacuating()
				|| (room.isClearingTerminal() && room.storage && room.storage.store.getFreeCapacity() < room.storage.store.getCapacity() * 0.3)
				|| (room.isClearingStorage() && room.terminal && room.terminal.store.getFreeCapacity() < room.terminal.store.getCapacity() * 0.3);
		});
	}

	public roomHasUncertainStorage(room: Room): boolean {
		if (!room) return true;

		return cache.inObject(room, 'roomHasUncertainStorage', 1, () => {
			return room.isEvacuating()
				|| room.isClearingStorage()
				|| room.isClearingTerminal();
		});
	}

	public roomNeedsStorageSpace(room: Room): boolean {
		return cache.inObject(room, 'roomNeedsStorageSpace', 1, () => {
			return room.terminal
				&& room.terminal.store.getFreeCapacity() < room.terminal.store.getCapacity() * 0.1
				&& room.storage
				&& room.storage.store.getFreeCapacity() < room.storage.store.getCapacity() * 0.1;
		});
	}

	public isEvacuatingRoomWithLowEnergy(room: Room): boolean {
		return cache.inObject(room, 'isEvacuatingRoomWithLowEnergy', 1, () => {
			return room.isEvacuating()
			&& room.getEffectiveAvailableEnergy() < 5000
			&& room.terminal.store.getUsedCapacity() > 10_000;
		});
	}
}
