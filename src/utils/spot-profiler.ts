let startCpu: number = 0;
let checkpoints: Array<[string, number]> = [];

/**
 * Captures the current CPU usage as the start of a profiled section and
 * clears any checkpoints from the previous run. Call this immediately before
 * the section you want to profile.
 */
export function resetSpotProfiler(): void {
  startCpu = Game.cpu.getUsed();
  checkpoints = [];
}

/**
 * Records the current CPU usage as the start of a named sub-section.
 * The label describes what begins at this point — the span from this mark
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
 * Output always has checkpoints.length + 1 spans:
 *   - "start": from resetSpotProfiler() to the first mark (or to now if no marks)
 *   - one span per mark label: from that mark to the next mark
 *   - "tail": from the last mark to now (omitted when there are no marks)
 *
 * Example with marks "pathfinding" and "dispatcher":
 *   [start: 0.12] [pathfinding: 2.31] [dispatcher: 1.44] [tail: 0.18]
 *
 * Example with no marks:
 *   [start: 3.05]
 *
 * @return {string}
 *   Formatted breakdown string. Never throws.
 */
export function flushSpotProfiler(): string {
  const endCpu = Game.cpu.getUsed();
  const parts: string[] = [];

  if (checkpoints.length === 0) {
    parts.push("[start: " + (endCpu - startCpu).toPrecision(3) + "]");
    return parts.join(" ");
  }

  // Span from start to first mark.
  parts.push("[start: " + (checkpoints[0][1] - startCpu).toPrecision(3) + "]");

  // Spans between consecutive marks.
  for (let i = 0; i < checkpoints.length - 1; i++) {
    const delta = checkpoints[i + 1][1] - checkpoints[i][1];
    parts.push("[" + checkpoints[i][0] + ": " + delta.toPrecision(3) + "]");
  }

  // Span from last mark to end, always labeled "tail".
  const lastCheckpoint = checkpoints[checkpoints.length - 1];
  parts.push("[tail: " + (endCpu - lastCheckpoint[1]).toPrecision(3) + "]");

  return parts.join(" ");
}
