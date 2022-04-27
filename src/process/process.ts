import ProcessInterface from 'process/process-interface';

declare global {
	interface ProcessParameters {
		interval?: number;
		priority?: number;
		throttleAt?: number;
		stopAt?: number;
		requireSegments?: boolean;
	}

	interface RoomProcessParameters extends ProcessParameters {
		room: Room;
	}
}

export default class Process implements ProcessInterface {
	public readonly id: string;
	protected parameters: ProcessParameters;

	/**
	 * Processes are run and managed by the hivemind kernel.
	 * @constructor
	 *
	 * @param {ProcessParameters} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: ProcessParameters) {
		this.parameters = parameters;
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
