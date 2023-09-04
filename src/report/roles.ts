import cache from 'utils/cache';

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
	}

	help() {
		return 'Get a listing of creeps per role on the shard, with stats for CPU usage.';
	}

}
