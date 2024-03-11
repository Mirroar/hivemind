import cache from 'utils/cache';
import {drawTable} from 'utils/room-visuals';
import {getCallStats, getElapsedTicks} from 'utils/cpu';

declare global {
	interface ReportClasses {
		ProcessReport: ProcessReport;
	}
}

export default class ProcessReport {
	visualize() {
		const visual = new RoomVisual();

		visual.text('Processes', 1, 48, {
			align: 'left',
		});

		drawTable({
			data: this.getProcessData(),
			top: 10,
			left: 1,
		}, visual);
	}

	getProcessData(): string[][] {
		const processData: string[][] = [['Process', 'CPU/tick', 'Total Calls', 'CPU Avg', 'Max CPU']];
		const cpuData = getCallStats('process:');
		const totalTicks = getElapsedTicks();
		for (const key in cpuData) {
			const record = cpuData[key];
			const perTick = (record.count * record.average) / totalTicks;
			if (perTick < 1) continue;

			const processName = key.slice(8);
			processData.push([processName, perTick.toPrecision(3), record.count.toString(), record.average.toPrecision(3), record.maximum.toPrecision(3)]);
		}

		return processData;
	}

	help() {
		return 'Get a listing of recently run processes, with stats for CPU usage.';
	}
}
