'use strict';

import test from 'ava';
import _ from 'lodash';

global._ = _;

require('../mock/constants');
const SpawnRole = require('../src/spawn-role');

test('body generation from weights', t => {
	const spawnRole = new SpawnRole();

	// Simple generation.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({move: 1}, 100),
		['move', 'move']
	);
	// Test weight distribution.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({move: 3, carry: 1}, 200),
		['move', 'carry', 'move', 'move']
	);
	// Test limiting number of body parts.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({move: 2, carry: 1}, 1000, {carry: 2}),
		['move', 'carry', 'move', 'carry', 'move', 'move']
	);
});
