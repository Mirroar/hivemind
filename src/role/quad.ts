
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import Role from 'role/role';
import TransporterRole from 'role/transporter';
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
	}

	interface QuadCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class RemoteBuilderRole extends Role {
	transporterRole: TransporterRole;
	navMesh: NavMesh;
	creep: QuadCreep;

	constructor() {
		super();

		// Military creeps are always fully active!
		this.stopAt = 0;
		this.throttleAt = 0;

		this.transporterRole = new TransporterRole();
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
  }
}
