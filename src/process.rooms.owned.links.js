'use strict';

/* global LINK_CAPACITY */

const Process = require('./process');

const ManageLinksProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

ManageLinksProcess.prototype = Object.create(Process.prototype);

ManageLinksProcess.prototype.shouldRun = function () {
	if (!Process.prototype.shouldRun.call(this)) return false;
	if (!this.room.linkNetwork) return false;

	return true;
};

/**
 * Moves energy between links.
 *
 * Determines which links serve as energy input or output, and transfers
 * dynamically between those and neutral links.
 */
ManageLinksProcess.prototype.run = function () {
	// Determine "requesting" links from link network.
	const highLinks = [];
	const lowLinks = [];
	const MIN_ENERGY_TRANSFER = LINK_CAPACITY / 4;

	for (const info of this.room.linkNetwork.overfullLinks) {
		highLinks.push({
			link: info.link,
			delta: info.delta,
		});
	}
	for (const info of this.room.linkNetwork.underfullLinks) {
		lowLinks.push({
			link: info.link,
			delta: info.delta,
		});
	}

	// Stop if there is no link needing action.
	if (highLinks.length === 0 && lowLinks.length === 0) return;

	let fromLink;
	let toLink;
	if (highLinks.length > 0) {
		const sorted = _.sortBy(_.filter(highLinks, link => link.link.cooldown <= 0), link => -link.delta);
		fromLink = sorted[0];
	}

	if (lowLinks.length > 0) {
		const sorted = _.sortBy(lowLinks, link => -link.delta);
		toLink = sorted[0];
	}

	if (this.room.linkNetwork.neutralLinks.length > 0) {
		// Use neutral links if necessary.
		if (!fromLink || fromLink.delta < MIN_ENERGY_TRANSFER) {
			const sorted = _.sortBy(_.filter(this.room.linkNetwork.neutralLinks, link => link.cooldown <= 0), link => -link.energy);
			if (sorted.length > 0) {
				fromLink = {
					link: sorted[0],
					delta: sorted[0].energy,
				};
			}
		}

		if (!toLink || toLink.delta < MIN_ENERGY_TRANSFER) {
			const sorted = _.sortBy(this.room.linkNetwork.neutralLinks, link => link.energy);
			toLink = {
				link: sorted[0],
				delta: sorted[0].energyCapacity - sorted[0].energy,
			};
		}
	}

	if (!fromLink || !toLink || fromLink.cooldown > 0) return;

	// Calculate maximum possible transfer amount, taking into account 3% cost on arrival.
	// @todo For some reason, using 1 + LINK_LOSS_RATIO as target amount results in ERR_FULL.
	const amount = Math.floor(Math.min(fromLink.delta, toLink.delta));
	if (amount < MIN_ENERGY_TRANSFER) return;

	const result = fromLink.link.transferEnergy(toLink.link, amount);
	if (result !== 0) {
		console.log(this.room.name, 'link transfer of', amount, 'energy failed:', result);
	}
};

module.exports = ManageLinksProcess;
