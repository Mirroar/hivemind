import HighwayRoomProcess from 'process/rooms/highway';
import hivemind, {PROCESS_PRIORITY_DEFAULT, PROCESS_PRIORITY_ALWAYS} from 'hivemind';
import interShard from 'intershard';
import OwnedRoomProcess from 'process/rooms/owned';
import Process from 'process/process';
import RoomIntelProcess from 'process/rooms/intel';
import RoomManager from 'room/room-manager';
import RoomManagerProcess from 'process/rooms/owned/manager';
import RoomPlanner from 'room/planner/room-planner';
import {isHighway} from 'utils/room-name';

declare global {
	interface Memory {
		mockRoomPlan: string;
	}
}

/**
 * Runs logic for all rooms we have visibility in.
 */
export default class RoomsProcess extends Process {
	/**
	 * Runs logic in all rooms.
	 */
	run() {
		_.each(Game.rooms, (room, roomName) => {
			hivemind.runProcess('rooms_intel', RoomIntelProcess, {
				room,
				priority: PROCESS_PRIORITY_ALWAYS,
				requireSegments: true,
			});

			// Manage owned rooms.
			// @todo Keep a list of managed rooms in memory so we can notice when
			// a room gets lost or a new one claimed.
			if (room.isMine()) {
				hivemind.runProcess('owned_rooms', OwnedRoomProcess, {
					room,
					priority: PROCESS_PRIORITY_ALWAYS,
				});
			}

			// Manage highway rooms.
			if (isHighway(roomName)) {
				hivemind.runProcess('highway_rooms', HighwayRoomProcess, {
					room,
					priority: PROCESS_PRIORITY_ALWAYS,
				});
			}
		});

		this.terminateRoomOperations();

		this.manageExpansionRoomPlan();
		this.manageInterShardExpansionRoomPlan();
		this.mockRoomPlan();
	}

	terminateRoomOperations() {
		// Stop operations for rooms that are no longer active.
		_.each(Game.operationsByType.room, op => {
			if (Game.time - op.getLastActiveTick() > 10_000) op.terminate();
		});
	}

	manageExpansionRoomPlan() {
		if (!Memory.strategy || !Memory.strategy.expand || !Memory.strategy.expand.currentTarget) return;
		if (!hivemind.segmentMemory.isReady()) return;

		this.runRoomPlannerAndManager(Memory.strategy.expand.currentTarget.roomName);
	}

	manageInterShardExpansionRoomPlan() {
		const memory = interShard.getLocalMemory();
		if (!memory.info.interShardExpansion || !memory.info.interShardExpansion.room) return;

		this.runRoomPlannerAndManager(memory.info.interShardExpansion.room);
	}

	runRoomPlannerAndManager(roomName: string) {
		const roomPlanner = new RoomPlanner(roomName);

		hivemind.runSubProcess('rooms_roomplanner', () => {
			// RoomPlanner has its own 100 tick throttling, so we runLogic every tick.
			roomPlanner.runLogic();
		});

		if (Game.rooms[roomName]) {
			const room = Game.rooms[roomName];
			room.roomPlanner = roomPlanner;
			room.roomManager = new RoomManager(room);

			const prioritizeRoomManager = room.roomManager.shouldRunImmediately();
			hivemind.runSubProcess('rooms_manager', () => {
				hivemind.runProcess(room.name + '_manager', RoomManagerProcess, {
					interval: prioritizeRoomManager ? 0 : (room.memory.isReclaimableSince ? 20 : 100),
					room,
					priority: prioritizeRoomManager ? PROCESS_PRIORITY_ALWAYS : PROCESS_PRIORITY_DEFAULT,
				});
			});
		}
	}

	mockRoomPlan() {
		if (Memory.mockRoomPlan && hivemind.segmentMemory.isReady()) {
			const planner = new RoomPlanner(Memory.mockRoomPlan);
			planner.runLogic();
		}
	}
}
