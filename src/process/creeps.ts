import container from 'utils/container';
import CreepManager from 'creep-manager';
import hivemind from 'hivemind';
import Process from 'process/process';
import TrafficManager from 'creep/traffic-manager';
import utilities from 'utilities';

import brawlerRole from 'role/brawler';
import builderRole from 'role/builder';
import caravanTraderRole from 'role/caravan-trader';
import claimerRole from 'role/claimer';
import depositHarvesterRole from 'role/harvester.deposit';
import dismantlerRole from 'role/dismantler';
import guardianRole from 'role/guardian';
import harvesterRole from 'role/harvester';
import helperRole from 'role/helper';
import mineBuilderRole from 'role/builder.mines';
import muleRole from 'role/mule';
import poweHarvesterRole from 'role/power/harvester';
import powerHaulerRole from 'role/power/hauler';
import relayHaulerRole from 'role/hauler.relay';
import remoteBuilderRole from 'role/builder.remote';
import remoteHarvesterRole from 'role/harvester.remote';
import scoutRole from 'role/scout';
import skKillerRole from 'role/sk-killer';
import transporterRole from 'role/transporter';
import unassignedRole from 'role/unassigned';
import upgraderRole from 'role/upgrader';

// Power creep roles.
import OperatorRole from 'role/power-creep/operator';

// Normal creep roles.
const creepRoles = {
	brawler: brawlerRole,
	builder: builderRole,
	'builder.mines': mineBuilderRole,
	'builder.remote': remoteBuilderRole,
	'caravan-trader': caravanTraderRole,
	claimer: claimerRole,
	dismantler: dismantlerRole,
	guardian: guardianRole,
	harvester: harvesterRole,
	'harvester.deposit': depositHarvesterRole,
	'harvester.power': poweHarvesterRole,
	'harvester.remote': remoteHarvesterRole,
	'hauler.power': powerHaulerRole,
	'hauler.relay': relayHaulerRole,
	helper: helperRole,
	mule: muleRole,
	scout: scoutRole,
	skKiller: skKillerRole,
	transporter: transporterRole,
	unassigned: unassignedRole,
	upgrader: upgraderRole,
};

export default class CreepsProcess extends Process {
	creepManager: CreepManager;
	powerCreepManager: CreepManager;
	trafficManager: TrafficManager;

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

		this.trafficManager = container.get('TrafficManager');
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

		// Resolve traffic jams.
		this.trafficManager.manageTraffic();
	}
}
