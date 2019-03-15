import test from 'ava';
import _ from 'lodash';

global._ = _;

require('../mock/constants');
const RoomPosition = require('../mock/room-position');

global.RoomPosition = RoomPosition;

const utilities = require('../src/utilities');

test.beforeEach(() => {
	global.Memory = {};
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

test('generateCreepBody', t => {
	t.deepEqual(utilities.generateCreepBody({move: 0.5, carry: 0.5}, 100), ['move', 'carry']);
	t.deepEqual(utilities.generateCreepBody({move: 0.5, carry: 0.5}, 200), ['move', 'carry', 'move', 'carry']);
	const limitedBody = utilities.generateCreepBody({move: 0.5, carry: 0.5}, 500, {move: 2});
	t.is(_.filter(limitedBody, part => part === 'move').length, 2);
});

test('generateEvenSequence', t => {
	const numbers = utilities.generateEvenSequence(3, 2);
	t.deepEqual(numbers, [8, 4, 2, 6, 1, 5, 3, 7]);
});

test('throttle', t => {
	global.Game = {
		cpu: {
			bucket: 5000,
		},
	};
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
