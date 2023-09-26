import {SourceMapConsumer} from 'source-map';

export class ErrorMapper {
	// Cache consumer
	private static _consumer?: SourceMapConsumer;

	public static get consumer(): SourceMapConsumer {
		if (this._consumer == null) {
			let sourceMap;
			try {
				sourceMap = require('main.map.js');
				this._consumer = new SourceMapConsumer(sourceMap);
			}
			catch {
				try {
					sourceMap = require('main.js.map');
					this._consumer = new SourceMapConsumer(sourceMap);
				}
				catch {}
			}
		}

		return this._consumer;
	}

	// Cache previously mapped traces to improve performance
	public static cache: Record<string, string> = {};

	/**
	 * Generates a stack trace using a source map generate original symbol names.
	 *
	 * WARNING - EXTREMELY high CPU cost for first call after reset - >30 CPU! Use sparingly!
	 * (Consecutive calls after a reset are more reasonable, ~0.1 CPU/ea)
	 *
	 * @param {Error | string} error The error or original stack trace
	 * @returns {string} The source-mapped stack trace
	 */
	public static sourceMappedStackTrace(error: Error | string): string {
		const stack: string = error instanceof Error ? (error.stack) : error;
		if (Object.prototype.hasOwnProperty.call(this.cache, stack)) {
			return this.cache[stack];
		}

		// eslint-disable-next-line no-useless-escape
		const re = /^\s+at\s+(.+?\s+)?\(?([0-z._\-\\/]+):(\d+):(\d+)\)?$/gm;
		let match: RegExpExecArray | null;
		let outStack = error.toString();

		while ((match = re.exec(stack))) {
			if (match[2] === 'main') {
				const pos = this.consumer.originalPositionFor({
					column: Number.parseInt(match[4], 10),
					line: Number.parseInt(match[3], 10),
				});

				if (pos.line != null) {
					if (pos.name) {
						outStack += `\n    at ${pos.name} (${pos.source}:${pos.line}:${pos.column})`;
					}
					else if (match[1]) {
						// No original source file name known - use file name from given trace
						outStack += `\n    at ${match[1]} (${pos.source}:${pos.line}:${pos.column})`;
					}
					else {
						// No original source file name known or in given trace - omit name
						outStack += `\n    at ${pos.source}:${pos.line}:${pos.column}`;
					}
				}
				else {
					// No known position
					outStack += '\n' + match[0];
					continue;
				}
			}
			else {
				// Line is not source mapped.
				outStack += '\n' + match[0];
				continue;
			}
		}

		this.cache[stack] = outStack;
		return outStack;
	}

	public static wrapLoop(loop: () => void): () => void {
		return () => {
			try {
				loop();
			}
			catch (error) {
				if (error instanceof Error) {
					if ('sim' in Game.rooms) {
						const message = 'Source maps don\'t work in the simulator - displaying original error';
						console.log(`<span style='color:red'>${message}<br>${_.escape(error.stack)}</span>`);
					}
					else {
						const message = _.escape(this.sourceMappedStackTrace(error));
						console.log(`<span style='color:red'>${message}</span>`);
						Game.notify(message);
					}
				}
				else {
					// Can't handle it
					throw error;
				}
			}
		};
	}
}
