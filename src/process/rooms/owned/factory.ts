import Process from 'process/process';
import settings from 'settings-manager';
import {drawTable} from 'utils/room-visuals';

export default class ManageFactoryProcess extends Process {
	room: Room;

	/**
	 * Manages which reactions take place in a room's labs.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: RoomProcessParameters) {
		super(parameters);
		this.room = parameters.room;
	}

	/**
	 * Sets appropriate reactions for each room depending on available resources.
	 */
	run() {
		if (!this.room.factory || !this.room.factoryManager) return;

		const data: string[][] = [['Status', 'Factory product']];
		const jobs = this.room.factoryManager.getJobs();
		const hasProduced = false;
		let product: FactoryProductConstant;
		for (product in jobs) {
			if (!this.room.factoryManager.hasAllComponents(product)) {
				data.push(['Missing components', product]);
				continue;
			}

			if (!this.room.factoryManager.isRecipeAvailable(product, jobs[product])) {
				data.push(['Production finished', product]);
				continue;
			}

			data.push(['Producing', product]);
			if (hasProduced) continue;
			if (this.room.factory.cooldown) continue;

			if (this.room.factory.produce(product as CommodityConstant) === OK && settings.get('notifyFactoryProduction')) Game.notify('Produced ' + product + ' in ' + this.room.name + '.');
		}

		if (data.length === 1) return;

		drawTable({
			data,
			top: 1,
			left: 25,
		}, this.room.visual);
	}
}
