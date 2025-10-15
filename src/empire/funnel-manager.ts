import cache from 'utils/cache';
import container from 'utils/container';
import TradeRoute from 'trade-route';
import RoomStatus from 'room/room-status';
import hivemind from 'hivemind';

interface TraderouteInfo {
	source: string;
	destination: string;
}

export default class FunnelManager {
	roomStatus: RoomStatus;

	constructor() {
		this.roomStatus = container.get('RoomStatus');
	}

	getRoomsToFunnel(): string[] {
		return cache.inHeap('funneledRooms', 500, () => {
			const funneledRooms: string[] = [];
			const roomsAtLevel: Record<number, Room[]> = _.groupBy(this.getAvailableRoomsToFunnel(), room => room.controller.level);

			const hasEnoughRCL8 = (roomsAtLevel[8]?.length || 0) > 1 || !hivemind.settings.get('prioritizeFunnelingToRCL8');
			const hasRCL7 = (roomsAtLevel[7]?.length || 0) > 0;
			const hasRCL6 = (roomsAtLevel[6]?.length || 0) > 0;
			const hasEnoughRCL7 = (roomsAtLevel[7]?.length || 0) > 2;
			const hasTooMuchEnergy = _.some(Game.myRooms, room => room.getEffectiveAvailableEnergy() > 300_000 && room.controller.level === 8);

			if (hasTooMuchEnergy) {
				// All rooms < RCL8 may upgrade.
				for (const room of [...(roomsAtLevel[6] || []), ...(roomsAtLevel[7] || [])]) {
					if (!funneledRooms.includes(room.name)) funneledRooms.push(room.name);
				}

				return funneledRooms;
			}

			if (hasEnoughRCL7 && !hasEnoughRCL8) {
				// Funnel to best RCL 7 room to get one to RCL 8.
				funneledRooms.push(_.max(roomsAtLevel[7], room => this.getFunnelRoomScore(room)).name);
			}
			else if (hasRCL6 || hasRCL7) {
				// Funnel to best RCL 6 or 7 room to get more spawn capacity.
				funneledRooms.push(_.max([
					...(roomsAtLevel[6] ?? []),
					...(roomsAtLevel[7] ?? []),
				], room => this.getFunnelRoomScore(room)).name);
			}

			// If GCL upgrade is close, don't funnel so we can be more energy efficient.
			if (this.getGclUpgradeScore() > _.max(funneledRooms.map(roomName => this.getFunnelRoomScore(Game.rooms[roomName])))) return [];

			return funneledRooms;
		});
	}

	protected getAvailableRoomsToFunnel(): Room[] {
		return _.filter(Game.myRooms, room => {
			if (!room.terminal) return false;
			if (room.isStripmine() && room.controller.level >= 6) return false;
			if (room.isEvacuating()) return false;

			return true;
		});
	}

	protected getFunnelRoomScore(room: Room) {
		const energyNeededToUpgrade = Math.max(0, room.controller.progressTotal - room.controller.progress);

		return this.roomStatus.getExpansionScore(room.name) / (energyNeededToUpgrade + 1);
	}

	protected getGclUpgradeScore() {
		const gclProgressNeeded = Math.max(0, Game.gcl.progressTotal - Game.gcl.progress);

		// @todo Maybe estimate it around the highest expansion score for a new room.
		return 10 / (gclProgressNeeded + 1);
	}

	isFunneling() {
		return this.getRoomsToFunnel().length > 0;
	}

	isFunnelingTo(roomName: string) {
		return this.getRoomsToFunnel().includes(roomName);
	}

	manageTradeRoutes() {
		const funnelTargets = _.filter(Game.myRooms, room => room.storage && room.controller.level < 6 && room.storage.store.getUsedCapacity() < room.storage.store.getCapacity() / 2);
		const funnelTradeRoutes = this.getRequestedFunnelTradeRoutes(funnelTargets);

		this.createAndUpdateTraderoutes(funnelTradeRoutes);
		this.removeUnneededTraderoutes(funnelTradeRoutes);
	}

	getRequestedFunnelTradeRoutes(funnelTargets: Room[]): TraderouteInfo[] {
		const tradeRoutes: TraderouteInfo[] = [];
		for (const room of funnelTargets) {
			const sourceRooms = _.filter(Game.myRooms, sourceRoom => sourceRoom.controller.level >= 7 && sourceRoom.getEffectiveAvailableEnergy() > 30_000 && Game.map.getRoomLinearDistance(room.name, sourceRoom.name) <= 5);
			for (const sourceRoom of sourceRooms) {
				tradeRoutes.push({
					source: sourceRoom.name,
					destination: room.name,
				});
			}
		}

		return tradeRoutes;
	}

	createAndUpdateTraderoutes(tradeRoutes: TraderouteInfo[]) {
		for (const route of tradeRoutes) {
			const name = 'funnel:' + route.source + ':' + route.destination;
			const tradeRoute = new TradeRoute(name);
			tradeRoute.setResourceType(RESOURCE_ENERGY);
			tradeRoute.setTarget(route.destination);
			tradeRoute.setOrigin(route.source);
			tradeRoute.setActive(true);
		}
	}

	removeUnneededTraderoutes(tradeRoutes: TraderouteInfo[]) {
		const allowedNames = [];
		for (const route of tradeRoutes) {
			allowedNames.push('funnel:' + route.source + ':' + route.destination);
		}

		for (const name in (Memory.tradeRoutes || {})) {
			if (!name.startsWith('funnel:')) continue;
			if (allowedNames.includes(name)) continue;

			const tradeRoute = new TradeRoute(name);
			tradeRoute.setActive(false);
		}
	}
}
