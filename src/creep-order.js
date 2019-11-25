'use strict';

module.exports = class CreepOrder {
	/**
	 * Adds order options for the given creep.
	 *
	 * @param {Creep} creep
	 *   The creep to add order options for.
	 * @param {Object[]} options
	 *   A list of order options to add to.
	 */
	getOptions() {}

	/**
	 * @todo Documentation.
	 */
	getEnergy(creep, emptyFirst, amount) {
		if (emptyFirst) {
			// If an amount is given, make sure we can store at least that amount.
			if (amount) {

			}
			else {

			}
		}
	}
};
