/* global RawMemory */



declare global {
	interface Memory {
		segmented: SegmentManagerMemory;
	}

	interface SegmentManagerMemory {
		lastFullSave: number;
		startSegment: number;
		endSegment: number;
	}
}

const maxActiveSegments = 10;
const maxSegmentLength = 100 * 1000;

export default class SegmentedMemory {
	_isReady: boolean;
	memory: SegmentManagerMemory;
	data: Record<string, any>;
	loadedSegments: Record<number, boolean>;
	totalLength: number;
	savedKeys: Record<string, boolean>;
	currentSegment: number;
	startSegment: number;
	savedSegments: number[];

	constructor() {
		this._isReady = false;
		this.data = {};
	}

	manage() {
		if (!Memory.segmented) {
			Memory.segmented = {
				// Force saving data immediately so we don't have wrongly formatted
				// old data in segment 0.
				lastFullSave: Game.time - 100,
				startSegment: 0,
				endSegment: 0,
			};

			// Since this is the first time segmented memory is loaded, there is no
			// data to load.
			this._isReady = true;
		}

		this.memory = Memory.segmented;
		this.savedSegments = [];
		// Currently requested (and thus visible) segments are always saved.
		for (let i = 0; i < 100; i++) {
			if (typeof RawMemory.segments[i] === 'string') this.savedSegments.push(i);
		}

		if (!this.isReady()) {
			this.reloadData();
			return;
		}

		if (Game.time - this.memory.lastFullSave > 100) {
			this.saveData();
		}
	}

	reloadData() {
		if (!this.loadedSegments) {
			this.loadedSegments = {};
			this.totalLength = 0;
		}

		let allLoaded = true;
		const nextActiveSegments = [];
		for (let i = this.memory.startSegment; i <= this.memory.endSegment; i++) {
			if (this.loadedSegments[i]) continue;

			if (typeof RawMemory.segments[i] === 'undefined') {
				allLoaded = false;
				if (nextActiveSegments.length < maxActiveSegments) nextActiveSegments.push(i);

				continue;
			}

			try {
				this.totalLength += RawMemory.segments[i].length;
				_.each(JSON.parse('{' + RawMemory.segments[i] + '}'), (value, key) => {
					this.data[key] = value;
				});
			}
			catch {
				hivemind.log('memory').error('Failed to load segmented memory from segment ' + i);
			}

			this.loadedSegments[i] = true;
		}

		RawMemory.setActiveSegments(nextActiveSegments);

		if (allLoaded) {
			this._isReady = true;
			delete this.loadedSegments;
			hivemind.log('memory').debug('Loaded', (this.totalLength / 1000).toPrecision(3) + 'kB of data from', this.memory.endSegment - this.memory.startSegment + 1, 'segments.');
		}
	}

	saveData() {
		if (!this.savedKeys) {
			this.savedKeys = {};
			this.currentSegment = (this.memory.startSegment === 0) ? 45 : 0;
			this.startSegment = this.currentSegment;
			this.totalLength = 0;
		}

		let stringified = '';
		let allSaved = true;
		_.each(this.data, (value, key) => {
			if (typeof RawMemory.segments[this.currentSegment] === 'undefined') {
				// Can't save more data this tick.
				RawMemory.setActiveSegments(_.range(this.currentSegment, this.currentSegment + maxActiveSegments - 1));
				allSaved = false;
				return false;
			}

			if (this.savedKeys[key]) return null;

			const part = JSON.stringify(value);
			const partLength = part.length + key.length + 4;

			if (stringified.length + partLength > maxSegmentLength) {
				this.saveToCurrentSegment(stringified);
				stringified = '';

				if (typeof RawMemory.segments[this.currentSegment] === 'undefined' && this.savedSegments.length >= maxActiveSegments) {
					// Can't save more data this tick.
					RawMemory.setActiveSegments(_.range(this.currentSegment, this.currentSegment + maxActiveSegments - 1));
					allSaved = false;
					return false;
				}
			}

			stringified += (stringified.length > 0 ? ',' : '') + '"' + key + '":' + part;
			this.savedKeys[key] = true;

			return null;
		});

		if (allSaved) {
			// Save remainder of data.
			this.saveToCurrentSegment(stringified);
			this.registerSaveCompletion();
		}
	}

	saveToCurrentSegment(data: string) {
		RawMemory.segments[this.currentSegment] = data;
		if (!this.savedSegments.includes(this.currentSegment)) this.savedSegments.push(this.currentSegment);
		this.totalLength += data.length;
		this.currentSegment++;
	}

	registerSaveCompletion() {
		this.memory.startSegment = this.startSegment;
		this.memory.endSegment = this.currentSegment - 1;
		this.memory.lastFullSave = Game.time;

		// Inform the user.
		hivemind.log('memory').debug('Saved', (this.totalLength / 1000).toPrecision(3) + 'kB of data to', this.currentSegment - this.startSegment, 'segments.');

		// Clean up.
		delete this.savedKeys;
		delete this.currentSegment;
		delete this.startSegment;
		delete this.totalLength;
	}

	isReady() {
		return this._isReady;
	}

	set<T>(key: string, value: T) {
		if (!this.isReady()) throw new Error('Segmented Memory is not ready yet.');

		this.data[key] = value;
	}

	get<T>(key: string): T {
		if (!this.isReady()) throw new Error('Segmented Memory is not ready yet.');

		return this.data[key];
	}

	delete(key: string) {
		if (!this.isReady()) throw new Error('Segmented Memory is not ready yet.');

		delete this.data[key];
	}

	has(key: string): boolean {
		if (!this.isReady()) throw new Error('Segmented Memory is not ready yet.');

		return typeof this.data[key] !== 'undefined';
	}

	each<T>(prefix: string, callback: (key: string, value?: T) => void) {
		for (const key in this.data) {
			if (key.startsWith(prefix)) callback(key, this.data[key]);
		}
	}

	forceSave() {
		if (!this.isReady()) throw new Error('Segmented Memory is not ready yet.');

		this.memory.lastFullSave = Game.time - 100;
	}

	getSavedSegmentsThisTick() {
		return this.savedSegments?.length || 0;
	}
}
