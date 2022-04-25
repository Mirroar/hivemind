import Process from 'process/process';

export default class ManageFactoryProcess extends Process {
	room: Room;

	/**
	 * Manages which reactions take place in a room's labs.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(parameters, data) {
		super(parameters, data);
		this.room = parameters.room;
	}

	/**
	 * Sets appropriate reactions for each room depending on available resources.
	 */
	run() {
		if (!this.room.factory || !this.room.factoryManager) return;
		if (this.room.factory.cooldown > 0) return;

		const jobs = this.room.factoryManager.getJobs();
		for (const product in jobs) {
			if (!this.room.factoryManager.hasAllComponents(product)) continue;
			if (!this.room.factoryManager.isRecipeAvailable(product, jobs[product])) continue;

			if (this.room.factory.produce(product as CommodityConstant) === OK) Game.notify('Produced ' + product + ' in ' + this.room.name + '.');
		}
	}
}
