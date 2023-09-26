import Process from 'process/process';
import {Request, RequestType, simpleAllies} from 'utils/communication';

declare global {
	interface Memory {
		requests: {
			trade: Record<string, Record<string, {
				amount: number;
				lastSeen: number;
				priority: number;
			}>>;
			defense: Record<string, {
				lastSeen: number;
				priority: number;
			}>;
		};
	}
}

export default class AlliesProcess extends Process {
	run() {
		if (!Memory.requests) {
			Memory.requests = {trade: {}, defense: {}};
		}

		simpleAllies.startOfTick();
		simpleAllies.checkAllies(request => {
			this.handleRequest(request);
		});
		this.makeResourceRequests();
		this.makeDefenseRequests();
		simpleAllies.endOfTick();
	}

	handleRequest(request: Request) {
		if (request.requestType === RequestType.RESOURCE || request.requestType === RequestType.FUNNEL) {
			const resourceType = request.requestType === RequestType.FUNNEL ? RESOURCE_ENERGY : request.resourceType;
			if (!RESOURCES_ALL.includes(resourceType)) return;

			if (!Memory.requests.trade[resourceType]) {
				Memory.requests.trade[resourceType] = {};
			}

			Memory.requests.trade[resourceType][request.roomName] = {
				amount: Math.min(request.maxAmount | 5000, 5000),
				lastSeen: Game.time,
				priority: Number(request.priority),
			};
		}
	}

	makeResourceRequests() {
		for (const room of Game.myRooms) {
			if (!room.storage || !room.terminal) continue;

			for (const resourceType of [RESOURCE_ENERGY, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM, RESOURCE_LEMERGIUM, RESOURCE_UTRIUM]) {
				const amount = room.getCurrentResourceAmount(resourceType);
				if (amount < 5000) {
					simpleAllies.requestResource(room.name, resourceType, (5000 - amount) / 20_000);
				}
			}
		}
	}

	makeDefenseRequests() {
		for (const roomName in (Memory.requests.defense || {})) {
			if (!Game.rooms[roomName]) continue;

			const request = Memory.requests.defense[roomName];
			if (Game.time - request.lastSeen < 10) {
				simpleAllies.requestHelp(roomName, request.priority);
				if (Game.rooms[roomName].getEffectiveAvailableEnergy() < 20_000) {
					simpleAllies.requestResource(roomName, RESOURCE_ENERGY, request.priority);
				}
			}
		}
	}
}
