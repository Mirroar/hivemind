import {PROCESS_PRIORITY_DEFAULT, PROCESS_PRIORITY_ALWAYS} from 'hivemind';
import hivemind from 'hivemind';
import OwnedRoomProcess from 'process/rooms/owned';
import Process from 'process/process';
import RoomIntelProcess from 'process/rooms/intel';
import RoomManager from 'room/room-manager';
import RoomManagerProcess from 'process/rooms/owned/manager';
import RoomPlanner from 'room/planner/room-planner';

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

			// Add roomPlanner to expansion target room.
			// @todo Maybe move to extra process, this is misplaced in this loop.
			if (Memory.strategy && Memory.strategy.expand && Memory.strategy.expand.currentTarget && Memory.strategy.expand.currentTarget.roomName === roomName && hivemind.segmentMemory.isReady()) {
				room.roomPlanner = new RoomPlanner(roomName);
				room.roomManager = new RoomManager(room);

				hivemind.runSubProcess('rooms_roomplanner', () => {
					// RoomPlanner has its own 100 tick throttling, so we runLogic every tick.
					room.roomPlanner.runLogic();
				});

				const prioritizeRoomManager = room.roomManager.shouldRunImmediately();
				hivemind.runSubProcess('rooms_manager', () => {
					hivemind.runProcess(room.name + '_manager', RoomManagerProcess, {
						interval: prioritizeRoomManager ? 0 : 100,
						room,
						priority: prioritizeRoomManager ? PROCESS_PRIORITY_ALWAYS : PROCESS_PRIORITY_DEFAULT,
					});
				});
			}
		});
	}
}
