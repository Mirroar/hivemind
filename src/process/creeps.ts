import container from 'utils/container';
import CreepManager from 'creep-manager';
import hivemind from 'hivemind';
import Process from 'process/process';
import TrafficManager from 'creep/traffic-manager';
import utilities from 'utilities';

// Power creep roles.
import OperatorRole from 'role/power-creep/operator';

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

		this.creepManager = container.get('CreepManager');

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
			if (!this.creepManager.hasRole(role)) return;

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
		hivemind.runSubProcess('creeps_powerCreeps', () => {
			utilities.bubbleWrap(() => {
				this.powerCreepManager.manageCreeps(powerCreeps);
			});
		});
		this.powerCreepManager.report();

		// Resolve traffic jams.
		hivemind.runSubProcess('creeps_trafficManager', () => {
			this.trafficManager.manageTraffic();
		});
	}
}
