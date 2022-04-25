/* global LINK_CAPACITY */

import Process from 'process/process';
import hivemind from 'hivemind';

export default class ManageLinksProcess extends Process {
	readonly MIN_ENERGY_TRANSFER = LINK_CAPACITY / 4;

	room: Room;

	/**
	 * Manages links in our rooms.
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
	 * Makes sure this process only runs when a link network is available.
	 *
	 * @return {boolean}
	 *   True if this process may be run.
	 */
	shouldRun() {
		if (!super.shouldRun()) return false;
		if (!this.room.linkNetwork) return false;

		return true;
	}

	/**
	 * Moves energy between links.
	 *
	 * Determines which links serve as energy input or output, and transfers
	 * dynamically between those and neutral links.
	 */
	run() {
		// Determine "requesting" links from link network.
		const highLinks = this.room.linkNetwork.overfullLinks;
		const lowLinks = this.room.linkNetwork.underfullLinks;

		// Stop if there is no link needing action.
		if (highLinks.length === 0 && lowLinks.length === 0) return;

		const fromLink = this.getBestSourceLink(highLinks);
		const toLink = this.getBestDesinationLink(lowLinks);

		if (!fromLink || !toLink) return;
		if (fromLink.link.id === toLink.link.id) return;

		// Calculate maximum possible transfer amount, taking into account 3% cost on arrival.
		// @todo For some reason, using 1 + LINK_LOSS_RATIO as target amount results in ERR_FULL.
		const amount = Math.floor(Math.min(fromLink.delta, toLink.delta));
		if (amount < this.MIN_ENERGY_TRANSFER) return;

		const result = fromLink.link.transferEnergy(toLink.link, amount);
		if (result !== 0) {
			hivemind.log('default', this.room.name).debug('link transfer of', amount, 'energy failed:', result);
		}
	}

	getBestSourceLink(highLinks: Array<{link: StructureLink; delta: number}>) {
		const sorted = _.sortBy(_.filter(highLinks, link => link.link.cooldown <= 0), link => -link.delta);

		if (sorted[0] && sorted[0].delta >= this.MIN_ENERGY_TRANSFER) return sorted[0];

		return this.getNeutralHighEnergyLink() || sorted[0];
	}

	getBestDesinationLink(lowLinks: Array<{link: StructureLink; delta: number}>) {
		const sorted = _.sortBy(lowLinks, link => -link.delta);

		if (sorted[0] && sorted[0].delta >= this.MIN_ENERGY_TRANSFER) return sorted[0];

		return this.getNeutralLowEnergyLink() || sorted[0];
	}

	getNeutralHighEnergyLink(): {link: StructureLink; delta: number} {
		const sorted = _.sortBy(_.filter(this.room.linkNetwork.neutralLinks, (link: StructureLink) => link.cooldown <= 0), link => -link.energy);
		if (sorted.length > 0) {
			return {
				link: sorted[0],
				delta: sorted[0].energy,
			};
		}

		return null;
	}

	getNeutralLowEnergyLink(): {link: StructureLink; delta: number} {
		const sorted = _.sortBy(this.room.linkNetwork.neutralLinks, (link: StructureLink) => link.energy);
		if (sorted.length > 0) {
			return {
				link: sorted[0],
				delta: sorted[0].energyCapacity - sorted[0].energy,
			};
		}

		return null;
	}
}
