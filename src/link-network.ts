type LinkAndDelta = {
	link: StructureLink,
	delta: number,
}

export default class LinkNetwork {
	links: StructureLink[];
	neutralLinks: StructureLink[];
	underfullLinks: LinkAndDelta[];
	overfullLinks: LinkAndDelta[];
	energyCapacity: number;
	energy: number;
	minEnergy: number;
	maxEnergy: number;

	/**
	 * Manages a group of link structures.
	 * @constructor
	 */
	constructor() {
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
	 *
	 * @param {StructureLink} link
	 *   The link structure to add to the network.
	 * @param {number} desiredEnergyLevel
	 *   The amount of energy this link should try to maintain.
	 */
	__addLink(link, desiredEnergyLevel) {
		this.links.push(link);
		this.energyCapacity += link.energyCapacity;
		this.energy += link.energy;

		if (typeof desiredEnergyLevel === 'number') {
			this.minEnergy += desiredEnergyLevel;
			this.maxEnergy += desiredEnergyLevel;

			if (link.energy < desiredEnergyLevel) {
				this.underfullLinks.push({
					link,
					delta: desiredEnergyLevel - link.energy,
				});
			}
			else if (link.energy > desiredEnergyLevel) {
				this.overfullLinks.push({
					link,
					delta: link.energy - desiredEnergyLevel,
				});
			}
		}
		else {
			this.neutralLinks.push(link);
			this.maxEnergy += link.energyCapacity;
		}
	}

	/**
	 * Adds a normal link with no preferred energy level.
	 *
	 * @param {StructureLink} link
	 *   The link structure to add to the network.
	 */
	addNeutralLink(link) {
		this.__addLink(link, null);
	}

	/**
	 * Adds a link that continuously gets energy inserted.
	 *
	 * @param {StructureLink} link
	 *   The link structure to add to the network.
	 */
	addInLink(link) {
		this.__addLink(link, 0);
	}

	/**
	 * Adds a link that continuously has energy removed.
	 *
	 * @param {StructureLink} link
	 *   The link structure to add to the network.
	 */
	addOutLink(link) {
		this.__addLink(link, link.energyCapacity);
	}

	/**
	 * Adds a link that serves as both input and output.
	 *
	 * @param {StructureLink} link
	 *   The link structure to add to the network.
	 */
	addInOutLink(link) {
		this.__addLink(link, link.energyCapacity / 2);
	}
}
