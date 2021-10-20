import test from 'ava';
import _ from 'lodash';

global._ = _;

require('../mock/constants');
const RoomPosition = require('../mock/room-position');

global.RoomPosition = RoomPosition;

const utilities = require('../src/utilities');

test.beforeEach(() => {
	global.Memory = {} as Memory;
});
test.afterEach(() => {
	delete global.Memory;
});

test('RoomPosition serialization', t => {
	const pos = new RoomPosition(1, 2, 'E1S1');
	const encoded = utilities.encodePosition(pos);
	const decoded = utilities.decodePosition(encoded);
	t.true(typeof encoded === 'string');
	t.deepEqual(pos, decoded);
});

test('RoomPosition path serialization', t => {
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
	const encoded = utilities.serializePositionPath(path);
	const decoded = utilities.deserializePositionPath(encoded);
	t.deepEqual(path, decoded, 'Paths should be the same after decoding.');

	const simpleEncoded = _.map(path, utilities.encodePosition);
	const simpleDecoded = utilities.deserializePositionPath(simpleEncoded);
	t.deepEqual(path, simpleDecoded, 'Decoding should work with simple arrays of encoded positions.');

	const encodedLength = JSON.stringify(encoded).length;
	const simpleLength = JSON.stringify(simpleEncoded).length;
	t.true(encodedLength < simpleLength, 'Encoded path should usually take less memory than simple encoding stored positions.');
});

test('getBestOption', t => {
	const options = [
		{weight: 0, priority: 2, id: 'higher'},
		{weight: 5, priority: 1, id: 'lowest'},
	];

	t.is(utilities.getBestOption(options).id, 'higher', 'Higher priority gets chosen even if weight of another option is higher.');
	options.push({weight: 1, priority: 2, id: 'highest'});
	t.is(utilities.getBestOption(options).id, 'highest', 'Within the same priority, higher weight wins.');
});

test('generateEvenSequence', t => {
	const numbers = utilities.generateEvenSequence(3, 2);
	t.deepEqual(numbers, [8, 4, 2, 6, 1, 5, 3, 7]);
});

test('throttle', t => {
	global.Game = {
		cpu: {
			bucket: 5000,
		} as CPU,
	} as Game;
	t.true(utilities.throttle(0, 5000, 8000));
	t.false(utilities.throttle(0, 3000, 5000));
	delete global.Game;
});

test('getThrottleOffset', t => {
	const a = utilities.getThrottleOffset();
	const b = utilities.getThrottleOffset();
	t.is(typeof a, 'number', 'Throttle offsets should be numbers');
	t.not(a, b, 'Subsequent calls should yield different offsets.');
});

test('handleMapArea', t => {
	const tiles = {};
	utilities.handleMapArea(5, 5, (x, y) => {
		tiles[x + '-' + y] = true;
	});
	t.deepEqual(tiles, {
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

	utilities.handleMapArea(6, 6, (x, y) => {
		tiles[x + '-' + y] = false;
	}, 0);
	t.deepEqual(tiles, {
		'4-4': true,
		'4-5': true,
		'4-6': true,
		'5-4': true,
		'5-5': true,
		'5-6': true,
		'6-4': true,
		'6-5': true,
		'6-6': false,
	}, 'Allow running for a certain range.');

	let counter = 0;
	utilities.handleMapArea(10, 10, () => {
		counter++;
		return false;
	});
	t.is(counter, 1, 'Callback may return false to prevent further calls.');

	counter = 0;
	utilities.handleMapArea(0, 1, () => {
		counter++;
	}, 2);
	t.is(counter, 12, 'Tiles outside of map area do not get processed.');

	counter = 0;
	utilities.handleMapArea(50, 50, () => {
		counter++;
	}, 2);
	t.is(counter, 4, 'Tiles outside of map area do not get processed.');

	const wrapper = {
		test: 'foo',
		run() {
			utilities.handleMapArea(10, 10, () => {
				this.test += '+';
			});
		},
	};
	wrapper.run();
	t.is(wrapper.test, 'foo+++++++++', 'Callback preserves `this` argument.');
});
