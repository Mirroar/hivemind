/* global OK MOVE CARRY */

import test from 'ava';
import _ from 'lodash';

global._ = _;

require('../mock/constants');
const SpawnManager = require('../src/spawn-manager');
const SpawnRole = require('../src/spawn-role');

test('initialization', t => {
	global.Memory = {} as Memory;
	const testRole = new SpawnRole();
	testRole.getSpawnOptions = (room, options) => {
		t.is(room.name, 'E1N1');
		options.push({
			priority: 1,
		});
	};

	testRole.getCreepBody = room => {
		t.is(room.name, 'E1N1');
		return ['move', 'work'];
	};

	const manager = new SpawnManager();
	manager.registerSpawnRole('test', testRole);

	const room = {name: 'E1N1'};
	const spawns = [{
		spawnCreep: (body, name, options) => {
			if (!options || !options.dryRun) {
				t.deepEqual(body, ['move', 'work']);
			}

			return OK;
		},
	}];

	t.plan(3);
	manager.manageSpawns(room, spawns);
});

test('choosing a spawn', t => {
	const manager = new SpawnManager();
	const unavailableSpawn = 'Spawn1';
	const availableSpawn = 'Spawn2';
	const spawns = [
		{name: unavailableSpawn, spawning: true},
		{name: availableSpawn, spawning: false},
	];
	const filteredSpawns = manager.filterAvailableSpawns(spawns);
	t.is(filteredSpawns.length, 1);
	t.is(filteredSpawns[0].name, availableSpawn);
});

test('spawn conditions', t => {
	global.Memory = {} as Memory;
	const testRole = new SpawnRole();
	testRole.getCreepBody = function () {
		return [MOVE, CARRY];
	};

	testRole.getSpawnOptions = function (room, options) {
		options.push({priority: 1});
	};

	const manager = new SpawnManager();
	manager.registerSpawnRole('test', testRole);

	const spawns = [
		{
			name: 'spawn',
			spawnCreep: (body, name, options) => {
				if (!options || !options.dryRun) {
					t.deepEqual(body, [MOVE, CARRY]);
				}

				return OK;
			},
		},
	];

	const room = {
		name: 'E1N1',
		energyAvailable: 0,
		energyCapacityAvailable: 500,
	};

	t.plan(1);

	// Nothing should spawn because no energy is available.
	manager.manageSpawns(room, spawns);

	// With full energy, our creep gets spawned.
	room.energyAvailable = room.energyCapacityAvailable;
	manager.manageSpawns(room, spawns);
});

test('optimization', t => {
	const manager = new SpawnManager();
	manager.registerSpawnRole('test', {
		getSpawnOptions: () => {
			t.fail('Options get checked even though all spawns are busy.');
		},
	});

	const room = {};
	const busySpawns = [{spawning: true}];

	manager.manageSpawns(room, busySpawns);
	t.plan(1);
	t.pass();
});

test('fallback values', t => {
	const manager = new SpawnManager();
	const roleId = 'test';
	manager.registerSpawnRole(roleId, {
		getSpawnOptions: (room, options) => options.push({}),
	});

	const options = manager.getAllSpawnOptions({});
	t.is(options[0].role, roleId);
});
