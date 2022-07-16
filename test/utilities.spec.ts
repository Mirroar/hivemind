import {mockGlobal} from "screeps-jest";
import {
	decodePosition,
	deserializePositionPath,
	encodePosition,
	serializePositionPath
} from "../src/utils/serialization";
import {getThrottleOffset, throttle} from "../src/utils/throttle";
import {handleMapArea} from "../src/utils/map";

describe('utils test', () => {
	beforeEach(() => {
		mockGlobal<Memory>('Memory', {}, true);
	});
	afterEach(() => {
	});

	it('RoomPosition serialization', t => {
	const pos = new RoomPosition(1, 2, 'E1S1');
	const encoded = encodePosition(pos);
	const decoded = decodePosition(encoded);
	expect(pos).toEqual(decoded);
});

	it('RoomPosition path serialization', t => {
		// Test path contains movement in all 8 directions, as well as room traversal.
		const path = [
			new RoomPosition(2, 2, 'E1N1'),
			new RoomPosition(2, 3, 'E2N1'),
			new RoomPosition(3, 4, 'E2N1'),
			new RoomPosition(4, 4, 'E2N1'),
			new RoomPosition(5, 3, 'E2N1'),
			new RoomPosition(5, 2, 'E2N1'),
			new RoomPosition(4, 1, 'E2N1'),
			new RoomPosition(4, 49, 'E2N2'),
			new RoomPosition(4, 48, 'E2N2'),
			new RoomPosition(3, 48, 'E2N2'),
			new RoomPosition(2, 49, 'E2N2'),
		];
		const encoded = serializePositionPath(path);
		const decoded = deserializePositionPath(encoded);
		expect(path).toEqual(decoded); //'Paths should be the same after decoding.'

		const simpleEncoded = _.map(path, encodePosition);
		const simpleDecoded = deserializePositionPath(simpleEncoded);
		expect(path).toEqual(simpleDecoded); // 'Decoding should work with simple arrays of encoded positions.');

		const encodedLength = JSON.stringify(encoded).length;
		const simpleLength = JSON.stringify(simpleEncoded).length;
		expect(encodedLength < simpleLength).toBeTruthy(); //'Encoded path should usually take less memory than simple encoding stored positions.');
	});

	// Need to change utils module for this test to work
	// it('getBestOption', t => {
	// 	const options = [
	// 		{weight: 0, priority: 2, id: 'higher'},
	// 		{weight: 5, priority: 1, id: 'lowest'},
	// 	];
	//
	// 	expect(utilities.getBestOption(options).id).toEqual('higher') //'Higher priority gets chosen even if weight of another option is higher.'
	// 	options.push({weight: 1, priority: 2, id: 'highest'});
	// 	expect(utilities.getBestOption(options).id).toEqual('highest'); //'Within the same priority, higher weight wins.'
	// });

	// it('generateEvenSequence', t => {
	// 	const numbers = generateEvenSequence(3, 2);
	// 	t.deepEqual(numbers, [8, 4, 2, 6, 1, 5, 3, 7]);
	// });

	it('throttle', t => {

		mockGlobal<Game>('Game', {cpu: {
				bucket: 5000,
			}}, true);
		expect(throttle(0, 5000, 8000)).toBeTruthy();
		expect(throttle(0, 3000, 5000)).toBeFalsy();
	});

	it('getThrottleOffset', t => {
		const a = getThrottleOffset();
		const b = getThrottleOffset();
		expect(typeof a).toEqual('number'); //'Throttle offsets should be numbers'
		expect(a===b).toBeFalsy(); //'Subsequent calls should yield different offsets.'
	});

	it('handleMapArea', t => {
		const tiles = {};
		handleMapArea(5, 5, (x, y) => {
			tiles[x + '-' + y] = true;
		});
		expect(tiles).toEqual( {
			'4-4': true,
			'4-5': true,
			'4-6': true,
			'5-4': true,
			'5-5': true,
			'5-6': true,
			'6-4': true,
			'6-5': true,
			'6-6': true,
		});

		handleMapArea(6, 6, (x, y) => {
			tiles[x + '-' + y] = false;
		}, 0);
		expect(tiles).toEqual({
			'4-4': true,
			'4-5': true,
			'4-6': true,
			'5-4': true,
			'5-5': true,
			'5-6': true,
			'6-4': true,
			'6-5': true,
			'6-6': false,
		}); //'Allow running for a certain range.'

		let counter = 0;
		handleMapArea(10, 10, () => {
			counter++;
			return false;
		});
		expect(counter).toEqual(1); //'Callback may return false to prevent further calls.'

		counter = 0;
		handleMapArea(0, 1, () => {
			counter++;
		}, 2);
		expect(counter).toEqual(12); //'Tiles outside of map area do not get processed.'

		counter = 0;
		handleMapArea(50, 50, () => {
			counter++;
		}, 2);
		expect(counter).toEqual(4); //'Tiles outside of map area do not get processed.'

		const wrapper = {
			test: 'foo',
			run() {
				handleMapArea(10, 10, () => {
					this.test += '+';
				});
			},
		};
		wrapper.run();
		expect(wrapper.test).toEqual('foo+++++++++'); //'Callback preserves `this` argument.'
	});
})
