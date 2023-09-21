import cache from 'utils/cache';
import {drawTable} from 'utils/room-visuals';

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
		const roleData: string[][] = [];

		roleData.push(['Role', 'Count', 'CPU Avg', 'Max CPU']);
		roleData.push(['testRole', '42', '0.52', '13.37']);

		return roleData;
	}

	help() {
		return 'Get a listing of creeps per role on the shard, with stats for CPU usage.';
	}

}
