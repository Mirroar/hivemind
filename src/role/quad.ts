import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import Role from 'role/role';
import Squad from 'manager.squad';
import TransporterRole from 'role/transporter';
import utilities from 'utilities';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

declare global {
	interface QuadCreep extends Creep {
		memory: QuadCreepMemory;
		heapMemory: QuadCreepHeapMemory;
	}

	interface QuadCreepMemory extends CreepMemory {
		role: 'quad';
		squadName: string;
		quadId?: string;
	}

	interface QuadCreepHeapMemory extends CreepHeapMemory {
		lastTick?: number;
		n?: number;
	}
}

export default class QuadRole extends Role {
	navMesh: NavMesh;
	creep: QuadCreep;
	squad: Squad;
	visual: RoomVisual;

	constructor() {
		super();

		// Military creeps are always fully active!
		this.stopAt = 0;
		this.throttleAt = 0;

		this.navMesh = new NavMesh();
	}

	/**
	 * Runs logic for remote builder creeps.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: QuadCreep) {
		this.creep = creep;
		this.squad = Game.squads[creep.memory.squadName];
		this.visual = creep.room.visual;

		if (creep.heapMemory.lastTick === Game.time) return;

		// @todo Gather at a certain spot in the room until 4 creeps are spawned.
		if (!this.creep.memory.quadId) {
			this.initializeQuad();
			return;
		}

		const quadCreeps = _.sortBy(_.filter(Game.creepsByRole.quad, (c: QuadCreep) => c.memory.quadId === creep.memory.quadId) as QuadCreep[], 'heapMemory.n');
		this.manageQuadCreeps(quadCreeps);
	}

	initializeQuad() {
		const inRoom = _.filter(this.creep.room.creepsByRole.quad, (c: QuadCreep) => !c.memory.quadId) as QuadCreep[];

		if (inRoom.length >= this.squad.getUnitCount('quad')) {
			const quadId = this.creep.memory.squadName + Game.time;
			for (const creep of inRoom) {
				creep.memory.quadId = quadId;
			}
		}

		this.creep.moveToRange(this.creep.room.controller.pos, 5);
	}

	manageQuadCreeps(creeps: QuadCreep[]) {
		this.markCreeps(creeps);

		// const isInFormation = this.createFormation(creeps);
		const path = this.getQuadPath(creeps[0], this.squad.getTarget());
	}

	markCreeps(creeps: QuadCreep[]) {
		let creepNumber = 1;
		for (const creep of creeps) {
			creep.heapMemory.lastTick = Game.time;
			if (!creep.heapMemory.n) creep.heapMemory.n = creepNumber++;
		}
	}

	createFormation(creeps: QuadCreep[]) {
		const anchorPosition = creeps[0].pos;
		let isInFormation = true;
		for (const index in creeps) {
			const creep = creeps[index];
			this.visual.text(index, creep.pos.x, creep.pos.y);

			const offsets = this.getPositionOffsets(Number(index));

			const targetPosition = new RoomPosition(anchorPosition.x + offsets.x, anchorPosition.y + offsets.y, anchorPosition.roomName);
			if (targetPosition.roomName !== creep.pos.roomName || targetPosition.x !== creep.pos.x || targetPosition.y !== creep.pos.y) {
				creep.moveToRange(targetPosition, 0);
				isInFormation = false;
			}
		}

		return isInFormation;
	}

	getQuadPath(creep: QuadCreep, target: RoomPosition) {
		const pfOptions = {
			allowDanger: true,
			maxRooms: 1,
		}

		const result = utilities.getPath(creep.pos, {
			pos: target,
			range: 0,
			isQuad: true,
		}, false, pfOptions);

		if (result && result.path) {
			const hue: number = cache.inHeap('creepColor:' + creep.name, 10000, (oldValue) => {
				return oldValue?.data ?? Math.floor(Math.random() * 360);
			});
			const color = 'hsl(' + hue + ', 50%, 50%)'

			creep.room.visual.poly(result.path, {
				fill: 'transparent',
				stroke: color,
				lineStyle: 'dashed',
				strokeWidth: .15,
				opacity: .3,
			});

			return result.path;
		}

		return [creep.pos];
	}

	getPositionOffsets(index: number) {
		const layer = Math.floor(Math.sqrt(index));
		const offset = index - layer * layer;

		if (offset < layer) {
			return {x: layer, y: offset};
		}

		return {x: offset - layer, y: layer};
	}
}
