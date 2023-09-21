interface TableDefinition {
	data: string[][];
	top: number;
	left: number;
}

function drawTable(table: TableDefinition, visual: RoomVisual) {
	const columnWidths = getColumnWidths(table.data);
	const totalWidth = _.sum(columnWidths);
	const totalHeight = table.data.length;

	const top = table.top + 0.8;
	const left = table.left + 0.2;

	visual.rect(left - 0.2, top - 0.8, totalWidth, 1, {
		fill: '#000000',
		opacity: 0.5,
	});

	visual.rect(left - 0.2, top - 0.8 + 1, totalWidth, totalHeight - 1, {
		fill: '#444444',
		opacity: 0.5,
	});

	for (let row = 0; row < table.data.length; row++) {
		let currentX = 0;
		for (let col = 0; col < table.data[row].length; col++) {
			visual.text(table.data[row][col], currentX + left, row + top, {
				align: 'left',
			})
			currentX += columnWidths[col];
		}
	}
}

function getColumnWidths(tableData: string[][]): number[] {
	const widths: number[] = [];
	for (let i = 0; i < tableData[0].length; i++) {
		const width = _.max(_.map(tableData, row => row[i]?.length ?? 0)) * 0.4 + 0.5;
		widths.push(width);
	}

	return widths;
}

export {
	drawTable,
}