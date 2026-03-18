let startCpu: number = 0;
let startHeapUsed: number | undefined;
let checkpoints: Array<[string, number]> = [];

/**
 * Captures the current CPU usage as the start of a profiled section and
 * clears any checkpoints from the previous run. Call this immediately before
 * the section you want to profile.
 */
export function resetSpotProfiler(): void {
	startCpu = Game.cpu.getUsed();
	startHeapUsed = Game.cpu.getHeapStatistics?.()?.used_heap_size;
	checkpoints = [];
}

/**
 * Records the current CPU usage as the start of a named sub-section.
 * The label describes what begins at this point -- the span from this mark
 * to the next mark (or to flushSpotProfiler) will carry this label.
 *
 * @param {string} label
 *   Name of the section starting at this point.
 */
export function mark(label: string): void {
	checkpoints.push([label, Game.cpu.getUsed()]);
}

/**
 * Computes per-section CPU deltas and returns a compact single-line summary.
 *
 * Output has checkpoints.length + 2 spans when marks are present:
 *   - "start": from resetSpotProfiler() to the first mark
 *   - one span per mark label: from that mark to the next mark (or to now for the last)
 *   - "tail": from the last mark to now
 *
 * With no marks, output is a single span:
 *   - "start": from resetSpotProfiler() to now
 *
 * Example with marks "pathfinding" and "dispatcher":
 *   [start: 0.12] [pathfinding: 2.31] [dispatcher: 1.44] [tail: 0.18]
 *   [start: 0.12] [pathfinding: 2.31] [dispatcher: 1.44] [tail: 0.18] [GC: -1.23MB]
 *
 * Example with no marks:
 *   [start: 3.05]
 *   [start: 3.05] [GC: -0.456MB]
 *
 * @return {string}
 *   Formatted breakdown string. Never throws.
 */
export function flushSpotProfiler(): string {
	const endCpu = Game.cpu.getUsed();
	const parts: string[] = [];

	if (checkpoints.length === 0) {
		parts.push('[start: ' + (endCpu - startCpu).toPrecision(3) + ']');

		// GC detection: if used heap shrank since reset, a collection likely ran.
		if (startHeapUsed !== undefined) {
			const endHeapUsed = Game.cpu.getHeapStatistics?.()?.used_heap_size;
			if (endHeapUsed !== undefined && endHeapUsed < startHeapUsed) {
				const freedMb = ((startHeapUsed - endHeapUsed) / (1024 * 1024)).toPrecision(3);
				parts.push('[GC: -' + freedMb + 'MB]');
			}
		}

		return parts.join(' ');
	}

	// Span from start to first mark.
	parts.push('[start: ' + (checkpoints[0][1] - startCpu).toPrecision(3) + ']');

	// Spans between consecutive marks (each mark's label covers the span it begins).
	for (let i = 0; i < checkpoints.length - 1; i++) {
		const delta = checkpoints[i + 1][1] - checkpoints[i][1];
		parts.push('[' + checkpoints[i][0] + ': ' + delta.toPrecision(3) + ']');
	}

	// Last mark's span: from last mark to end, labeled by that mark.
	const lastCheckpoint = checkpoints[checkpoints.length - 1];
	parts.push('[' + lastCheckpoint[0] + ': ' + (endCpu - lastCheckpoint[1]).toPrecision(3) + ']');

	// Tail span: always present, represents time after the last mark to flush.
	parts.push('[tail: ' + (Game.cpu.getUsed() - endCpu).toPrecision(3) + ']');

	// GC detection: if used heap shrank since reset, a collection likely ran.
	if (startHeapUsed !== undefined) {
		const endHeapUsed = Game.cpu.getHeapStatistics?.()?.used_heap_size;
		if (endHeapUsed !== undefined && endHeapUsed < startHeapUsed) {
			const freedMb = ((startHeapUsed - endHeapUsed) / (1024 * 1024)).toPrecision(3);
			parts.push('[GC: -' + freedMb + 'MB]');
		}
	}

	return parts.join(' ');
}
