'use strict';

/**
 * Manages a group of link structures.
 */
var LinkNetwork = function () {
	this.links = [];
	this.neutralLinks = [];
	this.underfullLinks = [];
	this.overfullLinks = [];
	this.energyCapacity = 0;
	this.energy = 0;
	this.minEnergy = 0;
	this.maxEnergy = 0;
};

/**
 * Adds a link with specified desired energy level to the network.
 */
LinkNetwork.prototype.__addLink = function (link, desiredEnergyLevel) {
	this.links.push(link);
	this.energyCapacity += link.energyCapacity;
	this.energy += link.energy;

	if (typeof(desiredEnergyLevel) === 'number') {
		this.minEnergy += desiredEnergyLevel;
		this.maxEnergy += desiredEnergyLevel;

		if (link.energy < desiredEnergyLevel) {
			this.underfullLinks.push({
				link: link,
				delta: desiredEnergyLevel - link.energy,
			});
		}
		else if (link.energy > desiredEnergyLevel) {
			this.overfullLinks.push({
				link: link,
				delta: link.energy - desiredEnergyLevel,
			});
		}
	}
	else {
		this.neutralLinks.push(link);
		this.maxEnergy += link.energyCapacity;
	}
};

/**
 * Adds a normal link.
 */
LinkNetwork.prototype.addNeutralLink = function (link) {
	this.__addLink(link, null);
};

/**
 * Adds a link that continuously gets energy inserted.
 */
LinkNetwork.prototype.addInLink = function (link) {
	this.__addLink(link, 0);
};

/**
 * Adds a link that continuously has energy removed.
 */
LinkNetwork.prototype.addOutLink = function (link) {
	this.__addLink(link, link.energyCapacity);
};

/**
 * Adds a link that serves as both input and output.
 */
LinkNetwork.prototype.addInOutLink = function (link) {
	this.__addLink(link, link.energyCapacity / 2);
};

module.exports = LinkNetwork;
