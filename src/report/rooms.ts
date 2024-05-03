import cache from 'utils/cache';
import FunnelManager from 'empire/funnel-manager';
import {drawTable} from 'utils/room-visuals';
import {getCallStats} from 'utils/cpu';

declare global {
	interface ReportClasses {
		RoomsReport: RoomsReport;
	}
}

interface RoomData {
	name: string;
	rcl: number;
	rclProgress: number;
	isFunneling: boolean;
	energyAvailable: number;
	weight: number;
	currentReaction?: string[];
	mineralType: string;
	storagePercent?: number;
	labUsage?: number;
}

export default class RoomsReport {
	private readonly funnelManager: FunnelManager;

	constructor(funnelManager: FunnelManager) {
		this.funnelManager = funnelManager;
	}

	visualize() {
		const visual = new RoomVisual();

		visual.text('Rooms', 1, 48, {
			align: 'left',
		});

		drawTable({
			data: this.getRoomTableData(),
			top: 10,
			left: 1,
		}, visual);
	}

	getRoomTableData(): string[][] {
		const roomData: string[][] = [['Room', 'RCL', 'Energy', 'Storage', 'Mineral', 'Labs']];

		for (const data of this.getAllRoomInfo()) {
			let rcl = data.rcl.toString();
			if (data.rcl < 8) {
				rcl += ' (' + (data.rclProgress * 100).toFixed(1) + '%)';
			}

			if (data.isFunneling) {
				rcl += '←';
			}

			roomData.push([
				data.name,
				rcl,
				data.energyAvailable.toFixed(0),
				data.storagePercent === null ? '-' : data.storagePercent.toFixed(1) + '%',
				data.mineralType,
				(data.currentReaction ? data.currentReaction.join('+') : '-') + (data.labUsage === null ? '' : ' (' + (data.labUsage * 100).toFixed(1) + '%)'),
			]);
		}

		return roomData;
	}

	getAllRoomInfo(): RoomData[] {
		const allData: RoomData[] = [];
		for (const room of Game.myRooms) {
			allData.push(this.getRoomInfo(room));
		}

		_.sortBy(allData, data => data.weight);
		return allData;
	}

	getRoomInfo(room: Room): RoomData {
		const weight = 0;

		return {
			name: room.name,
			rcl: room.controller.level,
			rclProgress: room.controller.level < 8 ? room.controller.progress / room.controller.progressTotal : 0,
			isFunneling: this.funnelManager.isFunnelingTo(room.name),
			energyAvailable: room.getEffectiveAvailableEnergy(),
			weight,
			currentReaction: room.memory.currentReaction,
			mineralType: _.map(room.minerals, m => m.mineralType).join(', '),
			storagePercent: (room.storage || room.terminal) ? ((1 - (room.getFreeStorage() / room.getStorageLimit())) * 100) : null,
			labUsage: (room.memory.labUsage?.total || 0) === 0 ? null : (room.memory.labUsage.busy / room.memory.labUsage.total),
		};
	}

	help() {
		return 'Get a listing of owned rooms on the shard, with stats for growth and resources.';
	}
}
