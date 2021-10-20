declare global {
  interface Room {
    getRoomPlan(): RoomPlan | null;
    setRoomPlan(plan?: RoomPlan);
  }

  interface RoomMemory {
    roomPlan: {
      plan: SerializedPlan;
      version: number;
    };
  }
}

import RoomPlan from 'room/room-plan';

const roomPlanCache: {
  [roomName: string]: RoomPlan;
} = {};

function getRoomPlanFor(roomName: string): RoomPlan | null {
  if (!Memory.rooms[roomName]) return null;
  if (!Memory.rooms[roomName].roomPlan) return null;
  if (roomPlanCache[roomName]) return roomPlanCache[roomName];

  const plan = new RoomPlan(roomName, Memory.rooms[roomName].roomPlan.version, Memory.rooms[roomName].roomPlan.plan);
  roomPlanCache[roomName] = plan;
  return plan;
}

function setRoomPlanFor(roomName: string, plan?: RoomPlan) {
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {} as RoomMemory;

  if (!plan) {
    delete Memory.rooms[roomName].roomPlan;
    delete roomPlanCache[roomName];
    return;
  }

  Memory.rooms[roomName].roomPlan = {
    plan: plan.serialize(),
    version: plan.getVersion(),
  };
  roomPlanCache[roomName] = plan;
}

Room.prototype.getRoomPlan = function (this: Room) {
  return getRoomPlanFor(this.name);
}

Room.prototype.setRoomPlan = function(this: Room, plan?: RoomPlan) {
  setRoomPlanFor(this.name, plan);
}

export {
  getRoomPlanFor,
  setRoomPlanFor,
};
