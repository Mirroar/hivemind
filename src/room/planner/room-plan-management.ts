import hivemind from 'hivemind';
import RoomPlan from 'room/planner/room-plan';

declare global {
	type RoomPlanWithVersion = {
		plan: RoomPlan;
		version: number;
	};
}

const roomPlanCache = new Map<string, RoomPlanWithVersion>();

function getRoomPlanFor(roomName: string): RoomPlanWithVersion | null {
	if (!hivemind.segmentMemory.isReady()) return null;

	const key = 'room-plan:' + roomName;
	if (!hivemind.segmentMemory.has(key)) return null;

	if (!roomPlanCache.has(roomName)) {
		const saved: {plan: SerializedPlan; version: number} = hivemind.segmentMemory.get(key);
		const plan = new RoomPlan(roomName, saved.plan);
		roomPlanCache.set(roomName, {plan, version: saved.version});
	}

	return roomPlanCache.get(roomName);
}

function setRoomPlanFor(roomName: string, plan: RoomPlan, version: number) {
	const key = 'room-plan:' + roomName;
	if (!plan) {
		hivemind.segmentMemory.delete(key);
		roomPlanCache.delete(roomName);
		return;
	}

	hivemind.segmentMemory.set(key, {
		plan: plan.serialize(),
		version,
	});
	roomPlanCache.set(roomName, {plan, version});
	Game.rooms[roomName]?.roomPlanner?.reloadRoomPlan();
}

export {
	getRoomPlanFor,
	setRoomPlanFor,
};
