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

		const roleData = this.getRoleData();
		this.drawTable(roleData, visual);
	}

	getRoleData(): string[][] {
		const roleData: string[][] = [];

		roleData.push(['Role', 'Count', 'CPU Avg', 'Max CPU']);
		roleData.push(['testRole', '42', '0.52', '13.37']);

		return roleData;
	}

	drawTable(tableData: string[][], visual: RoomVisual) {
		const columnWidths = this.getColumnWidths(tableData);
		const totalWidth = _.sum(columnWidths);
		const totalHeight = tableData.length;

		const top = 10;
		const left = 1;

		visual.rect(left - 0.2, top - 0.8, totalWidth, 1, {
			fill: '#000000',
			opacity: 0.5,
		});

		visual.rect(left - 0.2, top - 0.8 + 1, totalWidth, totalHeight - 1, {
			fill: '#000000',
			opacity: 0.2,
		});

		for (let row = 0; row < tableData.length; row++) {
			let currentX = 0;
			for (let col = 0; col < tableData[row].length; col++) {
				visual.text(tableData[row][col], currentX + left, row + top, {
					align: 'left',
				})
				currentX += columnWidths[col];
			}
		}
	}

	getColumnWidths(tableData: string[][]): number[] {
		const widths: number[] = [];
		for (let i = 0; i < tableData[0].length; i++) {
			const width = _.max(_.map(tableData, row => row[i]?.length ?? 0)) / 2 + 1;
			widths.push(width);
		}

		return widths;
	}

	help() {
		return 'Get a listing of creeps per role on the shard, with stats for CPU usage.';
	}

}
