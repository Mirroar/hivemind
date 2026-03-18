import hivemind from 'hivemind';
import Process from 'process/process';

// Number of ticks of history to keep and visualize.
const HISTORY_LENGTH = 100;

// Visual layout constants (in room coordinate units).
const LEFT = 1;
const TOP = 1;
const CHART_WIDTH = 20;
const CHART_HEIGHT = 8;

// Heap history stored in heap (resets on global reset, which is fine).
const usedHeapHistory: number[] = [];
const totalHeapHistory: number[] = [];

/**
 * Collects heap statistics every tick and draws a history chart
 * using global room visuals (visible in every room).
 */
export default class HeapVisualsProcess extends Process {
	run() {
		if (!hivemind.settings.get('showHeapVisuals')) return;

		const stats = Game.cpu.getHeapStatistics?.();
		if (!stats) return;

		// Record history.
		usedHeapHistory.push(stats.used_heap_size);
		totalHeapHistory.push(stats.total_heap_size);
		if (usedHeapHistory.length > HISTORY_LENGTH) {
			usedHeapHistory.shift();
			totalHeapHistory.shift();
		}

		this.draw(stats);
	}

	draw(stats: HeapStatistics) {
		const visual = new RoomVisual();

		// Background panel.
		visual.rect(LEFT - 0.3, TOP - 0.6, CHART_WIDTH + 0.6, CHART_HEIGHT + 4.2, {
			fill: '#111111',
			opacity: 0.75,
			stroke: '#444444',
			strokeWidth: 0.05,
		});

		// Title.
		visual.text('Heap Usage', LEFT + CHART_WIDTH / 2, TOP, {
			align: 'center',
			color: '#ffffff',
			font: 0.6,
		});

		// Draw the bar chart.
		const maxHeap = _.max(totalHeapHistory) || stats.heap_size_limit;
		const barWidth = CHART_WIDTH / HISTORY_LENGTH;
		const chartTop = TOP + 0.8;

		for (let i = 0; i < usedHeapHistory.length; i++) {
			const usedFraction = usedHeapHistory[i] / maxHeap;
			const totalFraction = totalHeapHistory[i] / maxHeap;
			const barX = LEFT + i * barWidth;

			// Total heap bar (dimmer).
			visual.rect(barX, chartTop + CHART_HEIGHT * (1 - totalFraction), barWidth, CHART_HEIGHT * totalFraction, {
				fill: '#335533',
				opacity: 1,
			});

			// Used heap bar (brighter).
			visual.rect(barX, chartTop + CHART_HEIGHT * (1 - usedFraction), barWidth, CHART_HEIGHT * usedFraction, {
				fill: '#44bb44',
				opacity: 1,
			});
		}

		// Chart border.
		visual.rect(LEFT, chartTop, CHART_WIDTH, CHART_HEIGHT, {
			fill: 'transparent',
			stroke: '#666666',
			strokeWidth: 0.05,
		});

		// Y-axis labels.
		const limitMb = (stats.heap_size_limit / (1024 * 1024)).toFixed(0);
		const maxMb = (maxHeap / (1024 * 1024)).toFixed(0);
		visual.text(maxMb + 'MB', LEFT - 0.1, chartTop + 0.3, {align: 'right', color: '#aaaaaa', font: 0.4});
		visual.text('0', LEFT - 0.1, chartTop + CHART_HEIGHT, {align: 'right', color: '#aaaaaa', font: 0.4});

		// Current stats text below the chart.
		const textTop = chartTop + CHART_HEIGHT + 0.8;
		const usedMb = (stats.used_heap_size / (1024 * 1024)).toFixed(2);
		const totalMb = (stats.total_heap_size / (1024 * 1024)).toFixed(2);
		const availMb = (stats.total_available_size / (1024 * 1024)).toFixed(2);
		const usedPercent = ((stats.used_heap_size / stats.heap_size_limit) * 100).toFixed(1);

		visual.text('Used: ' + usedMb + 'MB (' + usedPercent + '%)', LEFT, textTop, {align: 'left', color: '#44bb44', font: 0.45});
		visual.text('Total: ' + totalMb + 'MB', LEFT, textTop + 0.65, {align: 'left', color: '#338833', font: 0.45});
		visual.text('Available: ' + availMb + 'MB', LEFT, textTop + 1.3, {align: 'left', color: '#aaaaaa', font: 0.45});
		visual.text('Limit: ' + limitMb + 'MB', LEFT + CHART_WIDTH / 2, textTop, {align: 'left', color: '#888888', font: 0.45});
	}
}
