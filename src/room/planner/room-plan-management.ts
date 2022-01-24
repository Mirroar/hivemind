declare global {
  type RoomPlanWithVersion = {
    plan: RoomPlan;
    version: number;
  }
}

import hivemind from 'hivemind';
import RoomPlan from 'room/planner/room-plan';

const roomPlanCache: {
  [roomName: string]: RoomPlanWithVersion;
} = {};

function getRoomPlanFor(roomName: string): RoomPlanWithVersion | null {
  if (!hivemind.segmentMemory.isReady()) return null;

  const key = 'room-plan:' + roomName;
  if (!hivemind.segmentMemory.has(key)) return null;

  if (!roomPlanCache[roomName]) {
    const saved: {plan: SerializedPlan, version: number} = hivemind.segmentMemory.get(key);
    const plan = new RoomPlan(roomName, saved.plan);
    roomPlanCache[roomName] = {plan, version: saved.version};
  }

  return roomPlanCache[roomName];
}

function setRoomPlanFor(roomName: string, plan: RoomPlan, version: number) {
  const key = 'room-plan:' + roomName;
  if (!plan) {
    hivemind.segmentMemory.delete(key);
    delete roomPlanCache[roomName];
    return;
  }

  hivemind.segmentMemory.set(key, {
    plan: plan.serialize(),
    version,
  });
  roomPlanCache[roomName] = {plan, version};
}

export {
  getRoomPlanFor,
  setRoomPlanFor,
};
