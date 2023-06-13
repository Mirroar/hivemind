import cache from 'utils/cache';

export default class FunnelManager {
	constructor() {}

	getRoomsToFunnel(): string[] {
		return cache.inHeap('funneledRooms', 500, () => {
			const funneledRooms = [];
			const roomsAtLevel = _.groupBy(Game.myRooms, room => room.controller.level);

			const hasRCL8 = (roomsAtLevel[8]?.length || 0) > 0;
			const hasRCL7 = (roomsAtLevel[7]?.length || 0) > 0;
			const hasRCL6 = (roomsAtLevel[6]?.length || 0) > 0;
			const hasEnoughRCL7 = (roomsAtLevel[7]?.length || 0) > 2;

			if (
				(hasEnoughRCL7 && !hasRCL8) ||
				(!hasRCL6 && hasRCL7 && hasRCL8)
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

	isFunneling() {
		return this.getRoomsToFunnel().length > 0;
	}

	isFunnelingTo(roomName: string) {
		return this.getRoomsToFunnel().includes(roomName);
	}
}