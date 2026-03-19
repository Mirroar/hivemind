/* global RoomPosition FIND_SOURCES CREEP_LIFE_TIME WORK */

import RemoteMiningOperation from 'operation/remote-mining';
import {decodePosition, encodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

/**
 * Handles conversion of squad 'builder' units into their assigned civilian role
 * upon reaching the target expansion room. This logic lives here rather than in
 * the squad civilian role to keep conversion logic separate from travel logic.
 */
export default class SquadCivilianEscort {
	/**
	 * If this creep is a squad builder that has reached its target room, converts
	 * it to its intended civilian role. Safe to call every tick — returns
	 * immediately for non-builder units or units that lack a controller target.
	 *
	 * @param {SquadCivilianCreep} creep
	 *   The creep to potentially convert.
	 */
	attemptCivilianConversion(creep: SquadCivilianCreep): void {
		if (creep.memory.squadUnitType !== 'builder') return;
		if (!creep.room.controller) return;

		const specialization = creep.memory.squadCivilianSpecialization;

		if (specialization === 'harvester') {
			// Assign to the source with the fewest harvester-ticks already working it.
			const roomCreeps = creep.room.creepsByRole.harvester || {};
			const assignedCounts: Partial<Record<string, number>> = {};
			for (const creepName in roomCreeps) {
				const roomCreep = roomCreeps[creepName];
				const src = (roomCreep.memory as HarvesterCreepMemory).fixedSource;
				if (src) assignedCounts[src] = (assignedCounts[src] ?? 0) + (roomCreep.getActiveBodyparts(WORK) ?? 0) * (roomCreep.ticksToLive / CREEP_LIFE_TIME);
			}

			const bestSource = _.min(creep.room.find(FIND_SOURCES), s => assignedCounts[s.id] ?? 0);
			const newCreep = creep as unknown as HarvesterCreep;
			newCreep.memory.role = 'harvester';
			newCreep.memory.singleRoom = newCreep.pos.roomName;
			if (bestSource) newCreep.memory.fixedSource = bestSource.id;
			return;
		}

		if (specialization === 'transporter') {
			const newCreep = creep as unknown as TransporterCreep;
			newCreep.memory.role = 'transporter';
			newCreep.memory.singleRoom = newCreep.pos.roomName;
			return;
		}

		if (specialization === 'builder') {
			const newCreep = creep as unknown as BuilderCreep;
			newCreep.memory.role = 'builder';
			newCreep.memory.singleRoom = newCreep.pos.roomName;
			return;
		}

		if (specialization === 'remoteHarvester') {
			// Find a source in a neighboring room that is not yet saturated.
			const sourcePos = this.findSuitableNeighborSource(creep.pos.roomName);
			if (!sourcePos) return;

			// The Operation constructor writes to Memory.operations immediately, so
			// on the next tick's init pass the operation appears in Game.operations
			// and becomes available to harvesters and haulers via creep.operation.
			const operationName = 'mine:' + sourcePos.roomName;
			if (!Game.operations[operationName]) {
				const op = new RemoteMiningOperation(operationName);
				op.setRoom(sourcePos.roomName);
			}

			const newCreep = creep as unknown as RemoteHarvesterCreep;
			newCreep.memory.role = 'harvester.remote';
			newCreep.memory.source = encodePosition(sourcePos);
			newCreep.memory.operation = operationName;
			return;
		}

		if (specialization === 'relayHauler') {
			const newCreep = creep as unknown as RelayHaulerCreep;
			newCreep.memory.role = 'hauler.relay';
			newCreep.memory.sourceRoom = creep.pos.roomName;
			newCreep.memory.delivering = true;
			return;
		}

		// No specialization — rebrand as remote builder.
		const newCreep = creep as unknown as RemoteBuilderCreep;
		newCreep.memory.role = 'builder.remote';
		newCreep.memory.target = encodePosition(newCreep.pos);
		newCreep.memory.singleRoom = newCreep.pos.roomName;
	}

	/**
	 * Finds a source in a room neighbouring the given expansion room that has the
	 * fewest assigned remote-harvester WORK-ticks among all candidates.
	 *
	 * @param {string} expansionRoomName
	 *   The expansion target room to search around.
	 *
	 * @return {RoomPosition | null}
	 *   The position of a suitable source, or null if none found.
	 */
	findSuitableNeighborSource(expansionRoomName: string): RoomPosition | null {
		if (!Memory.strategy?.remoteHarvesting) return null;

		const sourceAssignments = Memory.strategy.remoteHarvesting.sourceAssignments ?? {};
		let bestSource: RoomPosition | null = null;
		let bestScore = Infinity;

		for (const [encoded, ownRoomName] of Object.entries(sourceAssignments)) {
			if (ownRoomName !== expansionRoomName) continue;

			const sourcePos = decodePosition(encoded);
			const remoteRoomName = sourcePos.roomName;
			const intel = getRoomIntel(remoteRoomName);
			if (intel.isOwned()) continue;
			if (intel.isSourceKeeperRoom()) continue;

			const assignedWork = _.sum(
				_.filter(Game.creepsByRole['harvester.remote'] as Record<string, RemoteHarvesterCreep>, c => c.memory.source === encoded),
				(c: Creep) => c.getActiveBodyparts(WORK) * (c.ticksToLive / CREEP_LIFE_TIME),
			);
			if (!bestSource || assignedWork < bestScore) {
				bestSource = sourcePos;
				bestScore = assignedWork;
			}
		}

		return bestSource;
	}
}
