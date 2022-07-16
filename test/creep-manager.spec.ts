import {mockGlobal, mockInstanceOf} from "screeps-jest";
import Hivemind from "../src/hivemind";
import CreepManager from "../src/creep-manager";

describe('creep-manager test', () => {

	beforeEach(() => {
		let _timeUsed = 0;

		mockGlobal<Game>('Game', {
			cpu: {
				bucket: 8000,
				getUsed() {
					return _timeUsed;
				},
			}
		}, true);

		mockGlobal<Memory>('Memory', {}, true);

		mockGlobal<Hivemind>('hivemind', {
			log: () => {
				return {
					debug() {},
					info() {},
					error() {},
				};
			},
		}, true);
	});

	afterEach(() =>{
	})

	it('role management', () => {

		const manager = new CreepManager();
		manager.registerCreepRole('test', {});

		const testCreep = mockInstanceOf<Creep>({memory:{role:'test'}});
		const diggerCreep = mockInstanceOf<Creep>({memory:{role:'digger'}});

		expect(manager.canManageCreep(testCreep)).toEqual(true);
		expect(manager.canManageCreep(diggerCreep)).toEqual(false);
	});

	it('running logic by role', t => {
		// const manager = new CreepManager();
		// manager.registerCreepRole('test', {run: creep => t.is(creep.name, 'foo', 'Run function should only be called for creeps with supported roles.')});
		//
		// t.plan(1);
		//
		// manager.manageCreeps({
		// 	first: getMockCreep('test', {name: 'foo'}),
		// 	second: getMockCreep('notest', {name: 'bar'}),
		// 	third: getMockCreep('test', {name: 'baz', spawning: true}),
		// });
		expect(false).toEqual(true);
	});

	it('preRun hooks', t => {
		// const manager = new CreepManager();
		// manager.registerCreepRole('test', {run: () => t.pass(), preRun: () => t.pass('preRun hook should be called.')});
		// manager.registerCreepRole('shouldNotRun', {run: () => t.fail('Don\'t call run function when preRun returns false.'), preRun: () => false});
		//
		// t.plan(2);
		//
		// manager.manageCreeps({
		// 	normal: getMockCreep('test'),
		// 	skipped: getMockCreep('shouldNotRun'),
		// });
		expect(false).toEqual(true);
	});

	it('changing roles', t => {
		// const manager = new CreepManager();
		// manager.registerCreepRole('test', {run: creep => {
		// 		creep.memory.role = 'new_role';
		// 	}});
		//
		// const creep = getMockCreep('test');
		// manager.manageCreeps([creep]);
		// t.is(creep.memory.role, 'new_role');
		expect(false).toEqual(true);
	});

	it('throttling', t => {
		// const manager = new CreepManager();
		// manager.registerCreepRole('low_priority', {throttleAt: 9500, stopAt: 8000, run: () => t.pass('Run function should always be called for creeps on exit tiles.')});
		// manager.registerCreepRole('high_priority', {throttleAt: 8000, stopAt: 500, run: () => t.pass('Run function should only be called if enough bucket available.')});
		//
		// t.plan(3);
		//
		// manager.manageCreeps([
		// 	getMockCreep('high_priority'),
		// 	getMockCreep('low_priority'),
		// 	getMockCreep('low_priority', {pos: new RoomPosition(0, 10, 'E1N1')}),
		// ]);
		//
		// t.is(manager.performance.total.throttled, 1, 'Stats about throttled creeps get recorded.');
		expect(false).toEqual(true);
	});

	it('cpu stats', t => {
		// let runCount = 0;
		// const manager = new CreepManager();
		// manager.registerCreepRole('slow', {run: () => {
		// 		Game.cpu._timeUsed += 100;
		// 	}});
		// manager.registerCreepRole('fast', {run: () => {
		// 		Game.cpu._timeUsed += 20 + ((runCount++) * 10);
		// 	}});
		//
		// manager.manageCreeps([
		// 	getMockCreep('fast'),
		// 	getMockCreep('slow'),
		// 	getMockCreep('fast'),
		// 	getMockCreep('fast'),
		// ]);
		//
		// t.is(manager.performance.slow.run, 1);
		// t.is(manager.performance.slow.total, 100);
		// t.is(manager.performance.fast.min, 20);
		// t.is(manager.performance.fast.max, 40);
		// t.is(manager.performance.total.run, 4);
		// t.is(manager.performance.total.total, 190);
		expect(false).toEqual(true);
	});

	it('cpu stats during multiple ticks', () => {
		const manager = new CreepManager();
		manager.registerCreepRole('test', {run: () => null});

		const roomPos=new RoomPosition(5,5,"test")
		manager.onTickStart();
		manager.manageCreeps([
			mockInstanceOf<Creep>({memory: {role: 'test'}, spawning: false, pos:roomPos}, true),
			mockInstanceOf<Creep>({memory: {role: 'test'}, spawning: false, pos:roomPos}, true),
		]);
		expect(manager.performance.total.run).toEqual(2);

		manager.onTickStart();
		manager.manageCreeps([
			mockInstanceOf<Creep>({memory:{role:'test'}, spawning: false, pos:roomPos}, true),
		]);
		expect(manager.performance.total.run).toEqual(1);
	});
});

