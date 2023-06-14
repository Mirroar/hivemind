import cache from 'utils/cache';

export default class FunnelManager {
	constructor() {}

	getRoomsToFunnel(): string[] {
		return cache.inHeap('funneledRooms', 500, () => {
			const funneledRooms = [];
			const roomsAtLevel = _.groupBy(this.getAvailableRoomsToFunnel(), room => room.controller.level);

			const hasRCL8 = (roomsAtLevel[8]?.length || 0) > 0;
			const hasRCL7 = (roomsAtLevel[7]?.length || 0) > 0;
			const hasRCL6 = (roomsAtLevel[6]?.length || 0) > 0;
			const hasEnoughRCL7 = (roomsAtLevel[7]?.length || 0) > 2;

			if (
				(hasEnoughRCL7 && !hasRCL8) ||
				(!hasRCL6 && hasRCL7) ||
			) {
				// Funnel to best RCL 7 room.
				funneledRooms.push(_.max(roomsAtLevel[7], room => Memory.strategy.roomList[room.name]?.expansionScore).name);
			}
			else if (hasRCL6) {
				// Funnel to best RCL 6 room.
				funneledRooms.push(_.max(roomsAtLevel[6], room => Memory.strategy.roomList[room.name]?.expansionScore).name);
			}

			return funneledRooms;
		});
	}

	protected getAvailableRoomsToFunnel(): Room[] {
		return _.filter(Game.myRooms, room => {
			if (room.isStripmine() && room.controller.level >= 6) return false;
			if (room.isEvacuating()) return false;

			return true;
		});
	}

	isFunneling() {
		return this.getRoomsToFunnel().length > 0;
	}

	isFunnelingTo(roomName: string) {
		return this.getRoomsToFunnel().includes(roomName);
	}
}