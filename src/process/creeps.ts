import CreepManager from 'creep-manager';
import hivemind from 'hivemind';
import Process from 'process/process';
import utilities from 'utilities';

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
import muleRole from 'role/mule';
import poweHarvesterRole from 'role/power/harvester';
import powerHaulerRole from 'role/power/hauler';
import remoteBuilderRole from 'role/builder.remote';
import remoteHarvesterRole from 'role/harvester.remote';
import scoutRole from 'role/scout';
import transporterRole from 'role/transporter';
import unassignedRole from 'role/unassigned';
import upgraderRole from 'role/upgrader';

// Normal creep roles.
const creepRoles = {
	'brawler': brawlerRole,
	'builder': builderRole,
	'builder.exploit': exploitBuilderRole,
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
	'helper': helperRole,
	'mule': muleRole,
	'scout': scoutRole,
	'transporter': transporterRole,
	'unassigned': unassignedRole,
	'upgrader': upgraderRole,
};

// Power creep roles.
import OperatorRole from 'role/power-creep/operator';

export default class CreepsProcess extends Process {
	creepManager: CreepManager;
	powerCreepManager: CreepManager;

	/**
	 * Runs logic for all creeps and power creeps.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		super(params, data);

		this.creepManager = new CreepManager();
		for (const roleName in creepRoles) {
			const RoleClass = creepRoles[roleName];
			this.creepManager.registerCreepRole(roleName, new RoleClass());
		}

		this.creepManager.registerCreepRole('harvester.minerals', this.creepManager.roles['harvester']);

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

		// Move blocking creeps if necessary.
		_.each(Game.creeps, creep => {
			if (creep._blockingCreepMovement) {
				creep.room.visual.text('X', creep.pos);
			}

			if (creep._blockingCreepMovement && !creep._hasMoveIntent) {
				if (creep.pos.getRangeTo(creep._blockingCreepMovement) === 1) {
					// Swap with blocked creep.
					creep.move(creep.pos.getDirectionTo(creep._blockingCreepMovement.pos));
					creep._blockingCreepMovement.move(creep._blockingCreepMovement.pos.getDirectionTo(creep.pos));
				}
				else {
					creep.moveTo(creep._blockingCreepMovement.pos, {range: 1});
				}
			}
		});
	}
}
