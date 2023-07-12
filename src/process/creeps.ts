import CreepManager from 'creep-manager';
import hivemind from 'hivemind';
import Process from 'process/process';
import utilities from 'utilities';
import {getCostMatrix} from 'utils/cost-matrix';
import {handleMapArea} from 'utils/map';

import brawlerRole from 'role/brawler';
import builderRole from 'role/builder';
import caravanTraderRole from 'role/caravan-trader';
import claimerRole from 'role/claimer';
import depositHarvesterRole from 'role/harvester.deposit';
import dismantlerRole from 'role/dismantler';
import exploitBuilderRole from 'role/exploit/builder';
import exploitHarvesterRole from 'role/exploit/harvester';
import exploitHaulerRole from 'role/exploit/hauler';
import gathererRole from 'role/gatherer';
import giftRole from 'role/gift';
import guardianRole from 'role/guardian';
import harvesterRole from 'role/harvester';
import haulerRole from 'role/hauler';
import helperRole from 'role/helper';
import mineBuilderRole from 'role/builder.mines';
import muleRole from 'role/mule';
import poweHarvesterRole from 'role/power/harvester';
import powerHaulerRole from 'role/power/hauler';
import relayHaulerRole from 'role/hauler.relay';
import remoteBuilderRole from 'role/builder.remote';
import remoteHarvesterRole from 'role/harvester.remote';
import scoutRole from 'role/scout';
import transporterRole from 'role/transporter';
import unassignedRole from 'role/unassigned';
import upgraderRole from 'role/upgrader';

// Power creep roles.
import OperatorRole from 'role/power-creep/operator';

// Normal creep roles.
const creepRoles = {
	'brawler': brawlerRole,
	'builder': builderRole,
	'builder.exploit': exploitBuilderRole,
	'builder.mines': mineBuilderRole,
	'builder.remote': remoteBuilderRole,
	'caravan-trader': caravanTraderRole,
	'claimer': claimerRole,
	'dismantler': dismantlerRole,
	'gatherer': gathererRole,
	'gift': giftRole,
	'guardian': guardianRole,
	'harvester': harvesterRole,
	'harvester.deposit': depositHarvesterRole,
	'harvester.exploit': exploitHarvesterRole,
	'harvester.power': poweHarvesterRole,
	'harvester.remote': remoteHarvesterRole,
	'hauler': haulerRole,
	'hauler.exploit': exploitHaulerRole,
	'hauler.power': powerHaulerRole,
	'hauler.relay': relayHaulerRole,
	'helper': helperRole,
	'mule': muleRole,
	'scout': scoutRole,
	'transporter': transporterRole,
	'unassigned': unassignedRole,
	'upgrader': upgraderRole,
};

export default class CreepsProcess extends Process {
	creepManager: CreepManager;
	powerCreepManager: CreepManager;

	/**
	 * Runs logic for all creeps and power creeps.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: ProcessParameters) {
		super(parameters);

		this.creepManager = new CreepManager();
		for (const roleName in creepRoles) {
			const RoleClass = creepRoles[roleName];
			this.creepManager.registerCreepRole(roleName, new RoleClass());
		}

		this.powerCreepManager = new CreepManager();
		this.powerCreepManager.registerCreepRole('operator', new OperatorRole());
	}

	/**
	 * Runs logic for all creeps.
	 */
	run() {
		// Run normal creeps.
		this.creepManager.onTickStart();
		_.each(Game.creepsByRole, (creeps, role) => {
			hivemind.runSubProcess('creeps_' + role, () => {
				utilities.bubbleWrap(() => {
					this.creepManager.manageCreeps(creeps);
				});
			});
		});
		this.creepManager.report();

		// Run power creeps.
		const powerCreeps = _.filter(Game.powerCreeps, creep => (creep.ticksToLive || 0) > 0);
		this.powerCreepManager.onTickStart();
		utilities.bubbleWrap(() => {
			this.powerCreepManager.manageCreeps(powerCreeps);
		});
		this.powerCreepManager.report();

		this.manageTraffic();
	}

	manageTraffic() {
		// Move blocking creeps if necessary.
		_.each(Game.creeps, creep => {
			if (!creep._blockingCreepMovement) return;
			if (creep._hasMoveIntent) return;

			const blockedCreep = creep._blockingCreepMovement;
			if (blockedCreep instanceof Creep && blockedCreep.fatigue) return;

			if (creep.pos.getRangeTo(blockedCreep) === 1) {
				const alternatePosition = this.getAlternateCreepPosition(creep);
				if (alternatePosition) {
					// Move aside for the other creep.
					creep.move(creep.pos.getDirectionTo(alternatePosition));
					blockedCreep.move(blockedCreep.pos.getDirectionTo(creep.pos));
				}
				else {
					// Swap with blocked creep.
					creep.move(creep.pos.getDirectionTo(blockedCreep.pos));
					blockedCreep.move(blockedCreep.pos.getDirectionTo(creep.pos));
				}
			}
			else {
				creep.moveTo(blockedCreep.pos, {range: 1});
			}
			creep._hasMoveIntent = true;
		});
	}

	getAlternateCreepPosition(creep: Creep | PowerCreep): RoomPosition | null {
		if (!creep._requestedMoveArea) return null;

		let alternatePosition: RoomPosition;
		const costMatrix = getCostMatrix(creep.room.name, {
			singleRoom: !!creep.memory.singleRoom,
		});

		// @todo If none of the alternate positions are free, check if
		// neighboring creeps can be pushed aside recursively.
		// @todo Prefer moving onto roads / plains instead of swamps.
		let blockingCreeps: Array<Creep | PowerCreep> = [];
		handleMapArea(creep.pos.x, creep.pos.y, (x, y) => {
			if (costMatrix.get(x, y) >= 100) return null;
			if (creep.room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return null;

			const pos = new RoomPosition(x, y, creep.room.name);
			if (pos.getRangeTo(creep._requestedMoveArea.pos) > creep._requestedMoveArea.range) return null;

			const blockingCreep = pos.lookFor(LOOK_CREEPS);
			if (blockingCreep.length > 0) {
				blockingCreeps.push(blockingCreep[0]);
				return null;
			}

			const blockingPowerCreep = pos.lookFor(LOOK_POWER_CREEPS);
			if (blockingPowerCreep.length > 0) {
				blockingCreeps.push(blockingPowerCreep[0]);
				return null;
			}

			alternatePosition = pos;
			return false;
		});

		if (!alternatePosition && blockingCreeps.length > 0) {
			for (const blockingCreep of blockingCreeps) {
				if (!blockingCreep.my) continue;
				if (blockingCreep._hasMoveIntent) continue;
				if (blockingCreep._blockingCreepMovement) continue;
				if (blockingCreep instanceof Creep && blockingCreep.fatigue) continue;

				blockingCreep._hasMoveIntent = true;
				const chainedAlternatePosition = this.getAlternateCreepPosition(blockingCreep);
				if (chainedAlternatePosition) {
					// Move aside for the other creep.
					blockingCreep.move(blockingCreep.pos.getDirectionTo(chainedAlternatePosition));
					return blockingCreep.pos;
				}
				delete blockingCreep._hasMoveIntent;
			}
		}

		if (alternatePosition) {
			creep.room.visual.line(alternatePosition.x, alternatePosition.y, creep.pos.x, creep.pos.y, {
				color: '#00ff00',
			});
		}

		return alternatePosition;
	}
}
