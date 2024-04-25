import container from 'utils/container';
import {drawTable} from 'utils/room-visuals';

declare global {
	interface ReportClasses {
		HelpReport: HelpReport;
	}
}

export default class HelpReport {
	visualize() {
		// @todo Dynamically get list of available reports.
		const reports: ReportType[] = [
			'HelpReport',
			'ProcessReport',
			'ResourcesReport',
			'RolesReport',
			'RoomsReport',
		];

		const visual = new RoomVisual();

		visual.text('Help', 1, 48, {
			align: 'left',
		});

		const tableData = [
			['Command', 'Info'],
			['report(null)', 'Stop showing reports.'],
		];
		for (const reportName of reports) {
			const label = 'report("' + reportName + '")';
			const description = container.get(reportName).help();

			tableData.push([label, description]);
		}

		drawTable({
			data: tableData,
			top: 10,
			left: 1,
		}, visual);
	}

	help() {
		return 'Show this list of possible reports.';
	}
}
