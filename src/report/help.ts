import container from 'utils/container';

declare global {
	interface ReportClasses {
		HelpReport: HelpReport;
	}
}

export default class HelpReport {
	visualize() {
		//@todo Dynamically get list of available reports.
		const reports: ReportType[] = ['HelpReport', 'ResourcesReport'];

		const visual = new RoomVisual();

		visual.text('Help', 1, 48, {
			align: 'left',
		});

		visual.text('report(null)', 1, 45, {align: 'left'});
		visual.text('Stop showing reports.', 10, 45, {align: 'left'});

		let row = 0;
		for (const reportName of reports) {
			const label = 'report("' + reportName + '")';
			const description = container.get(reportName).help();

			visual.text(label, 1, 44 - row, {align: 'left'});
			visual.text(description, 10, 44 - row, {align: 'left'});

			row++;
		}
	}

	help() {
		return 'Show this list of possible reports.';
	}
}
