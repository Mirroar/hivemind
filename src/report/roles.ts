import cache from 'utils/cache';
import {drawTable} from 'utils/room-visuals';
import {getCallStats} from 'utils/cpu';

declare global {
	interface ReportClasses {
		RolesReport: RolesReport;
	}
}

export default class RolesReport {

	visualize() {
		const visual = new RoomVisual();

		visual.text('Roles', 1, 48, {
			align: 'left',
		});

		drawTable({
			data: this.getRoleData(),
			top: 10,
			left: 1,
		}, visual);
	}

	getRoleData(): string[][] {
		const roleData: string[][] = [['Role', 'Creep Count', 'Total Calls', 'CPU Avg', 'Max CPU']];
		let cpuData = getCallStats('creepRole:');
		for (const key in cpuData) {
			const record = cpuData[key];
			const roleName = key.substr(10);
			roleData.push([roleName, _.size(Game.creepsByRole[roleName]).toString(), record.count.toString(), record.average.toPrecision(3), record.maximum.toPrecision(3)]);
		}

		return roleData;
	}

	help() {
		return 'Get a listing of creeps per role on the shard, with stats for CPU usage.';
	}

}
