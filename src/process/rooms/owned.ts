/* global POWER_SPAWN_ENERGY_RATIO STRUCTURE_TOWER */

import balancer from 'excess-energy-balancer';
import ManageFactoryProcess from 'process/rooms/owned/factory';
import ManageLabsProcess from 'process/rooms/owned/labs';
import ManageLinksProcess from 'process/rooms/owned/links';
import ManageSpawnsProcess from 'process/rooms/owned/spawns';
import Process from 'process/process';
import RoomDefenseProcess from 'process/rooms/owned/defense';
import RoomManagerProcess from 'process/rooms/owned/manager';
import RoomSongsProcess from 'process/rooms/owned/songs';
import RoomOperation from 'operation/room';
import hivemind, {PROCESS_PRIORITY_LOW, PROCESS_PRIORITY_DEFAULT, PROCESS_PRIORITY_ALWAYS, PROCESS_PRIORITY_HIGH} from 'hivemind';
import {timeCall} from 'utils/cpu';

declare global {
	interface Memory {
		roomStats: Record<string, Record<string, number>>;
	}
}

export default class OwnedRoomProcess extends Process {
	room: Room;

	/**
	 * Manages rooms we own.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: RoomProcessParameters) {
		super(parameters);
		this.room = parameters.room;
	}

	/**
	 * Manages one of our rooms.
	 */
	run() {
		const operationName = 'room:' + this.room.name;
		let operation = Game.operationsByType.room[operationName];
		if (!operation) {
			operation = new RoomOperation(operationName);
			operation.setRoom(this.room.name);
		}

		// Draw bays.
		if (!hivemind.settings.get('disableRoomVisuals')) {
			for (const bay of this.room.bays || []) {
				const visual = this.room.visual;
				let color = '255, 255, 128';
				if (bay.isBlocked()) color = '255, 0, 0';
				else if (bay.energyCapacity === 0) color = '128, 128, 128';
				visual.rect(bay.pos.x - 1.4, bay.pos.y - 1.4, 2.8, 2.8, {
					fill: 'rgba(' + color + ', 0.2)',
					opacity: 0.5,
					stroke: 'rgba(' + color + ', 1)',
				});
			}
		}

		const totalTime = timeCall('operation:' + operationName, () => {
			hivemind.runSubProcess('rooms_roomplanner', () => {
				// RoomPlanner has its own 100 tick throttling, so we runLogic every tick.
				if (this.room.roomPlanner) this.room.roomPlanner.runLogic();
			});

			if (this.room.roomManager) {
				const prioritizeRoomManager = this.room.roomManager.shouldRunImmediately();
				hivemind.runSubProcess('rooms_manager', () => {
					hivemind.runProcess(this.room.name + '_manager', RoomManagerProcess, {
						interval: prioritizeRoomManager ? 0 : 100,
						room: this.room,
						priority: prioritizeRoomManager ? PROCESS_PRIORITY_ALWAYS : PROCESS_PRIORITY_DEFAULT,
					});
				});
			}

			// @todo Only run processes based on current room level or existing structures.
			hivemind.runSubProcess('rooms_defense', () => {
				hivemind.runProcess(this.room.name + '_defense', RoomDefenseProcess, {
					room: this.room,
					priority: PROCESS_PRIORITY_ALWAYS,
				});
			});

			hivemind.runSubProcess('rooms_links', () => {
				hivemind.runProcess(this.room.name + '_links', ManageLinksProcess, {
					interval: 3,
					room: this.room,
					priority: PROCESS_PRIORITY_HIGH,
				});
			});

			hivemind.runSubProcess('rooms_labs', () => {
				hivemind.runProcess(this.room.name + '_labs', ManageLabsProcess, {
					room: this.room,
					priority: PROCESS_PRIORITY_ALWAYS,
				});
			});

			hivemind.runSubProcess('rooms_spawns', () => {
				hivemind.runProcess(this.room.name + '_spawns', ManageSpawnsProcess, {
					room: this.room,
					priority: PROCESS_PRIORITY_ALWAYS,
				});
			});

			hivemind.runSubProcess('rooms_power', () => {
				// Process power in power spawns.
				const powerSpawn = this.room.powerSpawn;
				if (powerSpawn && powerSpawn.my && powerSpawn.power > 0 && powerSpawn.energy >= POWER_SPAWN_ENERGY_RATIO && powerSpawn.processPower() === OK) balancer.recordPowerEnergy(POWER_SPAWN_ENERGY_RATIO);
			});

			hivemind.runSubProcess('rooms_factory', () => {
				hivemind.runProcess(this.room.name + '_factory', ManageFactoryProcess, {
					room: this.room,
					priority: PROCESS_PRIORITY_ALWAYS,
				});
			});

			hivemind.runSubProcess('rooms_observers', () => {
				// Use observers if requested.
				if (this.room.observer && this.room.memory.observeTargets && this.room.memory.observeTargets.length > 0) {
					const target = this.room.memory.observeTargets.pop();
					this.room.observer.observeRoom(target);
					this.room.observer.hasScouted = true;
					hivemind.log('intel', this.room.name).info('Observing', target);
				}
			});

			hivemind.runSubProcess('rooms_songs', () => {
				// Sing a song.
				hivemind.runProcess(this.room.name + '_song', RoomSongsProcess, {
					room: this.room,
					priority: PROCESS_PRIORITY_LOW,
				});
			});

			hivemind.runSubProcess('rooms_stats', () => {
				this.gatherStats();
			});
		});

		operation.addCpuCost(totalTime);
	}

	gatherStats() {
		if (!hivemind.settings.get('recordRoomStats')) return;

		const roomName = this.room.name;

		if (!Memory.roomStats) Memory.roomStats = {};
		if (!Memory.roomStats[roomName]) {
			Memory.roomStats[roomName] = {
				claimed: Game.time,
			};
		}

		const memory = Memory.roomStats[roomName];
		const key = 'rcl' + this.room.controller.level;
		if (!memory[key]) memory[key] = Game.time - memory.claimed;

		if (!memory.tower && (this.room.myStructuresByType[STRUCTURE_TOWER] || []).length > 0) {
			memory.tower = Game.time - memory.claimed;
		}

		if (!memory.storage && this.room.storage) {
			memory.storage = Game.time - memory.claimed;
		}
	}
}
