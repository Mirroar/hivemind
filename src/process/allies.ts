import hivemind from 'hivemind';
import Process from 'process/process';
import {FunnelGoal, simpleAllies} from 'utils/communication';

declare global {
	interface Memory {
		requests: {
			trade: Record<string, Record<string, {
				amount: number;
				lastSeen: number;
				priority: number;
				timeout?: number;
			}>>;
			defense: Record<string, {
				lastSeen: number;
				priority: number;
				timeout?: number;
			}>;
		};
	}
}

export default class AlliesProcess extends Process {
	run() {
		if (!Memory.requests) {
			Memory.requests = {trade: {}, defense: {}};
		}

		if (hivemind.relations.allies.length === 0) return;

		simpleAllies.initRun();
		this.handleRequests();
		this.makeResourceRequests();
		this.makeDefenseRequests();

		// @todo Add funnel requests.
		simpleAllies.endRun();
	}

	handleRequests() {
		for (const request of simpleAllies.allySegmentData?.requests?.funnel ?? []) {
			if (!Memory.requests.trade[RESOURCE_ENERGY]) {
				Memory.requests.trade[RESOURCE_ENERGY] = {};
			}

			Memory.requests.trade[RESOURCE_ENERGY][request.roomName] = {
				amount: Math.min(request.maxAmount | 5000, 5000),
				lastSeen: Game.time,
				priority: (request.goalType === FunnelGoal.RCL7) ? 3
					: ((request.goalType === FunnelGoal.RCL8) ? 2
						: (request.goalType === FunnelGoal.GCL) ? 1 : -1),
				timeout: request.timeout ?? (Game.time + 100),
			};
		}

		for (const request of simpleAllies.allySegmentData?.requests?.resource ?? []) {
			const resourceType = request.resourceType;
			if (!RESOURCES_ALL.includes(resourceType)) return;

			if (!Memory.requests.trade[resourceType]) {
				Memory.requests.trade[resourceType] = {};
			}

			Memory.requests.trade[resourceType][request.roomName] = {
				amount: Math.min(request.amount | 5000, 5000),
				lastSeen: Game.time,
				priority: Number(request.priority),
				// @todo handle timeout
				timeout: request.timeout ?? (Game.time + 100),
			};
		}
	}

	makeResourceRequests() {
		for (const room of Game.myRooms) {
			if (!room.storage || !room.terminal) continue;

			for (const resourceType of [RESOURCE_ENERGY, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM, RESOURCE_LEMERGIUM, RESOURCE_UTRIUM]) {
				const amount = room.getCurrentResourceAmount(resourceType);
				if (amount < 5000) {
					simpleAllies.requestResource({
						roomName: room.name,
						resourceType,
						priority: (5000 - amount) / 20_000,
						amount: 5000,
						terminal: true,
						timeout: Game.time + 20,
					});
				}
			}
		}
	}

	makeDefenseRequests() {
		for (const roomName in (Memory.requests.defense || {})) {
			if (!Game.rooms[roomName]) continue;

			const request = Memory.requests.defense[roomName];
			if (Game.time - request.lastSeen < 10) {
				simpleAllies.requestDefense({
					roomName,
					priority: request.priority,
				});
				if (Game.rooms[roomName].getEffectiveAvailableEnergy() < 20_000 && Game.rooms[roomName].terminal?.isOperational()) {
					simpleAllies.requestResource({
						roomName,
						resourceType: RESOURCE_ENERGY,
						priority: request.priority,
						amount: Math.max(5000, 20_000 - Game.rooms[roomName].getEffectiveAvailableEnergy()),
						terminal: true,
						timeout: Game.time + 20,
					});
				}
			}
		}
	}
}
