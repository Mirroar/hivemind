declare global {
  interface Room {
    getRoomPlan(): RoomPlanWithVersion | null;
    setRoomPlan(plan: RoomPlan, version: number);
  }

  interface RoomMemory {
    roomPlan: {
      plan: SerializedPlan;
      version: number;
    };
  }

  type RoomPlanWithVersion = {
    plan: RoomPlan;
    version: number;
  }
}

import RoomPlan from 'room/planner/room-plan';

const roomPlanCache: {
  [roomName: string]: RoomPlanWithVersion;
} = {};

function getRoomPlanFor(roomName: string): RoomPlanWithVersion | null {
  if (!Memory.rooms[roomName]) return null;
  if (!Memory.rooms[roomName].roomPlan) return null;

  if (!roomPlanCache[roomName]) {
    const plan = new RoomPlan(roomName, Memory.rooms[roomName].roomPlan.plan);
    roomPlanCache[roomName] = {plan, version: Memory.rooms[roomName].roomPlan.version};
  }

  return roomPlanCache[roomName];
}

function setRoomPlanFor(roomName: string, plan: RoomPlan, version: number) {
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {} as RoomMemory;

  if (!plan) {
    delete Memory.rooms[roomName].roomPlan;
    delete roomPlanCache[roomName];
    return;
  }

  Memory.rooms[roomName].roomPlan = {
    plan: plan.serialize(),
    version,
  };
  roomPlanCache[roomName] = {plan, version};
}

Room.prototype.getRoomPlan = function (this: Room) {
  return getRoomPlanFor(this.name);
}

Room.prototype.setRoomPlan = function(this: Room, plan: RoomPlan, version: number) {
  setRoomPlanFor(this.name, plan, version);
}

export {
  getRoomPlanFor,
  setRoomPlanFor,
};
