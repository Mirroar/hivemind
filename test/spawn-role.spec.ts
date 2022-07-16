/* global MOVE CARRY ATTACK RANGED_ATTACK HEAL TOUGH MAX_CREEP_SIZE */

import SpawnRole from "../src/spawn-role/spawn-role";

describe('spawn role test', () => {
	it('body generation from weights', () => {
		const spawnRole = new SpawnRole();

		// Simple generation.
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1}, 100)).toEqual([MOVE, MOVE]);
		// Test weight distribution.
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 3, [CARRY]: 1}, 200)).toEqual(
			[MOVE, CARRY, MOVE, MOVE]
		);
		// Test limiting number of body parts.
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 2, [CARRY]: 1}, 1000, {[CARRY]: 2})).toEqual(
			[MOVE, CARRY, MOVE, CARRY, MOVE, MOVE]
		);
		// Tough parts should be at the front of the creep.
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [TOUGH]: 1}, 1000, {[MOVE]: 2})).toEqual(
			[TOUGH, TOUGH, MOVE, MOVE]
		);
		// Combat parts should be at the rear end of the creep.
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [ATTACK]: 1}, 1000, {[MOVE]: 2})).toEqual(
			[MOVE, MOVE, ATTACK, ATTACK]
		);
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [RANGED_ATTACK]: 1}, 1000, {[MOVE]: 2})).toEqual(
			[MOVE, MOVE, RANGED_ATTACK, RANGED_ATTACK]
		);
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1, [HEAL]: 1}, 1000, {[MOVE]: 2})).toEqual(
			[MOVE, MOVE, HEAL, HEAL]
		);
		// Respect MAX_CREEP_SIZE.
		expect(spawnRole.generateCreepBodyFromWeights({[MOVE]: 1}, 10000).length).toEqual(MAX_CREEP_SIZE);
	});
})
