import ProcessInterface from 'process/process-interface';

export default class Process implements ProcessInterface {
	id: string;
	data: any;

	/**
	 * Processes are run and managed by the hivemind kernel.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		this.data = data;
	}

	/**
	 * Determines whether this process should run this tick.
	 *
	 * @return {boolean}
	 *   Whether this process is allowed to run.
	 */
	shouldRun(): boolean {
		return true;
	}

	/**
	 * Runs the given process.
	 */
	run() {
		console.error('Trying to run a process `' + this.id + '` without implemented functionality.');
	}
}
