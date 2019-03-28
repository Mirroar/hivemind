import test from 'ava';
import _ from 'lodash';

global._ = _;

require('../mock/constants');
const RoomPosition = require('../mock/room-position');
const MockHivemind = require('../mock/hivemind');

global.RoomPosition = RoomPosition;

const CreepManager = require('../src/creep-manager');

const getMockCreep = function (role, options) {
	const creep = {
		memory: {
			role: role || 'test',
		},
		pos: new RoomPosition(25, 25, 'E1N1'),
	};
	_.each(options, (value, key) => {
		creep[key] = value;
	});

	return creep;
};

test.beforeEach(() => {
	global.Game = {
		cpu: {
			bucket: 8000,
			_timeUsed: 0,
			getUsed() {
				return this._timeUsed;
			},
		},
	};
	global.Memory = {};
	global.hivemind = new MockHivemind();
});
test.afterEach(() => {
	delete global.Memory;
	delete global.Game;
});

test('role management', t => {
	const manager = new CreepManager();
	manager.registerCreepRole('test', {});

	t.true(manager.canManageCreep(getMockCreep('test')));
	t.false(manager.canManageCreep(getMockCreep('digger')));
});

test('running logic by role', t => {
	const manager = new CreepManager();
	manager.registerCreepRole('test', {run: creep => t.is(creep.name, 'foo', 'Run function should only be called for creeps with supported roles.')});

	t.plan(1);

	manager.manageCreeps({
		first: getMockCreep('test', {name: 'foo'}),
		second: getMockCreep('notest', {name: 'bar'}),
		third: getMockCreep('test', {name: 'baz', spawning: true}),
	});
});

test('throttling', t => {
	const manager = new CreepManager();
	manager.registerCreepRole('low_priority', {throttleAt: 9500, stopAt: 8000, run: () => t.pass('Run function should always be called for creeps on exit tiles.')});
	manager.registerCreepRole('high_priority', {throttleAt: 8000, stopAt: 500, run: () => t.pass('Run function should only be called if enough bucket available.')});

	t.plan(3);

	manager.manageCreeps([
		getMockCreep('high_priority'),
		getMockCreep('low_priority'),
		getMockCreep('low_priority', {pos: new RoomPosition(0, 10, 'E1N1')}),
	]);

	t.is(manager.performance.total.throttled, 1, 'Stats about throttled creeps get recorded.');
});

test('cpu stats', t => {
	let runCount = 0;
	const manager = new CreepManager();
	manager.registerCreepRole('slow', {run: () => {
		Game.cpu._timeUsed += 100;
	}});
	manager.registerCreepRole('fast', {run: () => {
		Game.cpu._timeUsed += 20 + ((runCount++) * 10);
	}});

	manager.manageCreeps([
		getMockCreep('fast'),
		getMockCreep('slow'),
		getMockCreep('fast'),
		getMockCreep('fast'),
	]);

	t.is(manager.performance.slow.run, 1);
	t.is(manager.performance.slow.total, 100);
	t.is(manager.performance.fast.min, 20);
	t.is(manager.performance.fast.max, 40);
	t.is(manager.performance.total.run, 4);
	t.is(manager.performance.total.total, 190);
});

test('cpu stats during multiple ticks', t => {
	const manager = new CreepManager();
	manager.registerCreepRole('test', {run: () => null});

	manager.onTickStart();
	manager.manageCreeps([
		getMockCreep('test'),
		getMockCreep('test'),
	]);
	t.is(manager.performance.total.run, 2);

	manager.onTickStart();
	manager.manageCreeps([
		getMockCreep('test'),
	]);
	t.is(manager.performance.total.run, 1);
});
