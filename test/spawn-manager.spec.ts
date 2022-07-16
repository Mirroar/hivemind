/* global OK MOVE CARRY */

import {mockGlobal, mockInstanceOf} from "screeps-jest";
import Hivemind from "../src/hivemind";
import SpawnManager from "../src/spawn-manager";
import SpawnRole from "../src/spawn-role/spawn-role";
import utilities from 'utilities';

jest.mock('../src/utilities', () => ({}));

describe('spawn-manager test', () => {

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

		// @ts-ignore
		mockGlobal<utilities>('utilities', {
		}, true);
	});

	afterEach(() =>{
	})

	it('initialization', t => {
		// global.Memory = {} as Memory;
		// const testRole = new SpawnRole();
		// testRole.getSpawnOptions = (room, options) => {
		// 	t.is(room.name, 'E1N1');
		// 	options.push({
		// 		priority: 1,
		// 	});
		// };
		//
		// testRole.getCreepBody = room => {
		// 	t.is(room.name, 'E1N1');
		// 	return ['move', 'work'];
		// };
		//
		// const manager = new SpawnManager();
		// manager.registerSpawnRole('test', testRole);
		//
		// const room = {name: 'E1N1'};
		// const spawns = [{
		// 	spawnCreep: (body, name, options) => {
		// 		if (!options || !options.dryRun) {
		// 			t.deepEqual(body, ['move', 'work']);
		// 		}
		//
		// 		return OK;
		// 	},
		// }];
		//
		// t.plan(3);
		// manager.manageSpawns(room, spawns);
		expect(false).toEqual(true);
	});

	it('choosing a spawn', () => {
		const manager = new SpawnManager();
		const unavailableSpawn = 'Spawn1';
		const availableSpawn = 'Spawn2';
		const spawns = [
			mockInstanceOf<StructureSpawn>({memory:{role:'test'},name: unavailableSpawn, spawning: {}}),
				mockInstanceOf<StructureSpawn>({memory:{role:'test'},name: availableSpawn, spawning: null}),
		];
		const filteredSpawns = manager.filterAvailableSpawns(spawns);
		expect(filteredSpawns.length).toEqual(1);
		expect(filteredSpawns[0].name).toEqual(availableSpawn);
	});

	it('spawn conditions', t => {
		// global.Memory = {} as Memory;
		// const testRole = new SpawnRole();
		// testRole.getCreepBody = function () {
		// 	return [MOVE, CARRY];
		// };
		//
		// testRole.getSpawnOptions = function (room, options) {
		// 	options.push({priority: 1});
		// };
		//
		// const manager = new SpawnManager();
		// manager.registerSpawnRole('test', testRole);
		//
		// const spawns = [
		// 	{
		// 		name: 'spawn',
		// 		spawnCreep: (body, name, options) => {
		// 			if (!options || !options.dryRun) {
		// 				t.deepEqual(body, [MOVE, CARRY]);
		// 			}
		//
		// 			return OK;
		// 		},
		// 	},
		// ];
		//
		// const room = {
		// 	name: 'E1N1',
		// 	energyAvailable: 0,
		// 	energyCapacityAvailable: 500,
		// };
		//
		// t.plan(1);
		//
		// // Nothing should spawn because no energy is available.
		// manager.manageSpawns(room, spawns);
		//
		// // With full energy, our creep gets spawned.
		// room.energyAvailable = room.energyCapacityAvailable;
		// manager.manageSpawns(room, spawns);
		expect(false).toEqual(true);
	});

	it('optimization', t => {
		// const manager = new SpawnManager();
		// manager.registerSpawnRole('test', {
		// 	getSpawnOptions: () => t.fail('Options get checked even though all spawns are busy.'),
		// });
		//
		// const room = {};
		// const busySpawns = [{spawning: true}];
		//
		// manager.manageSpawns(room, busySpawns);
		// t.plan(1);
		// t.pass();
		expect(false).toEqual(true);
	});

	it('fallback values', () => {
		const manager = new SpawnManager();
		const roleId = 'test';

		const spawnOption=mockInstanceOf<SpawnOption>({
			role:undefined,
			priority: 1,
			weight: 1,});

		manager.registerSpawnRole(roleId, mockInstanceOf<SpawnRole>({
			getSpawnOptions: (room) => [spawnOption]
			}
		));

		const options = manager.getAllSpawnOptions(mockInstanceOf<Room>());
		expect(options[0].role).toEqual(roleId);
	});
});
