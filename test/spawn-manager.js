'use strict';

import test from 'ava';
import _ from 'lodash';

global._ = _;

const SpawnManager = require('../src/spawn-manager');

test('initialization', t => {
	const manager = new SpawnManager();
	manager.registerSpawnRole('test', {
		getSpawnOptions: (room, options) => {
			t.is(room.name, 'E1N1');
			options.push({
				priority: 1,
				weight: 0,
				role: 'test',
			});
		},
		getBody: room => {
			t.is(room.name, 'E1N1');
			return ['move', 'work'];
		},
	});

	const room = {name: 'E1N1'};
	const spawns = [{
		spawnCreep: body => {
			t.deepEqual(body, ['move', 'work']);
		},
	}];

	t.plan(3);
	manager.manageSpawns(room, spawns);
});

test('choosing a spawn', t => {
	const manager = new SpawnManager();
	const spawns = [
		{name: 'Spawn1', spawning: true},
		{name: 'Spawn2', spawning: false},
	];
	const filteredSpawns = manager.filterAvailableSpawns(spawns);
	t.is(filteredSpawns.length, 1);
	t.is(filteredSpawns[0].name, 'Spawn2');
});

test('optimization', t => {
	const manager = new SpawnManager();
	manager.registerSpawnRole('test', {
		getSpawnOptions: () => t.fail('Options get checked even though all spawns are busy.'),
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
