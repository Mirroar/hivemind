/* global MOVE CARRY ATTACK RANGED_ATTACK HEAL TOUGH MAX_CREEP_SIZE */

import test from 'ava';
import _ from 'lodash';

global._ = _;

require('../mock/constants');
const SpawnRole = require('../src/spawn-role');

test('body generation from weights', t => {
	const spawnRole = new SpawnRole();

	// Simple generation.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 1}, 100),
		[MOVE, MOVE],
	);
	// Test weight distribution.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 3, [CARRY]: 1}, 200),
		[MOVE, CARRY, MOVE, MOVE],
	);
	// Test limiting number of body parts.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 2, [CARRY]: 1}, 1000, {[CARRY]: 2}),
		[MOVE, CARRY, MOVE, CARRY, MOVE, MOVE],
	);
	// Tough parts should be at the front of the creep.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [TOUGH]: 1}, 1000, {[MOVE]: 2}),
		[TOUGH, TOUGH, MOVE, MOVE],
	);
	// Combat parts should be at the rear end of the creep.
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [ATTACK]: 1}, 1000, {[MOVE]: 2}),
		[MOVE, MOVE, ATTACK, ATTACK],
	);
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [RANGED_ATTACK]: 1}, 1000, {[MOVE]: 2}),
		[MOVE, MOVE, RANGED_ATTACK, RANGED_ATTACK],
	);
	t.deepEqual(
		spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [HEAL]: 1}, 1000, {[MOVE]: 2}),
		[MOVE, MOVE, HEAL, HEAL],
	);
	// Respect MAX_CREEP_SIZE.
	t.is(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1}, 10_000).length, MAX_CREEP_SIZE);
});
