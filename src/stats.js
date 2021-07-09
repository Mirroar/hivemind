'use strict';

const stats = {

	/**
	 * Saves a new stat value for long term history tracking.
	 *
	 * @param {string} key
	 *   Identifier this information should be stored under.
	 * @param {number} value
	 *   Most current value to save.
	 */
	recordStat(key, value) {
		if (!Memory.history) {
			Memory.history = {};
		}

		if (!Memory.history[key]) {
			Memory.history[key] = {};
		}

		stats.saveStatValue(Memory.history[key], 1, value);
	},

	/**
	 * Recursively saves new data in long term history.
	 *
	 * @param {object} memory
	 *   The object to store history data.
	 * @param {number} multiplier
	 *   Interval we are currently concerned with.
	 * @param {number} value
	 *   Value to save.
	 */
	saveStatValue(memory, multiplier, value) {
		const increment = 10;

		if (typeof memory[multiplier] === 'undefined') {
			memory[multiplier] = {
				currentValues: [],
				previousValues: [],
			};
		}

		if (memory[multiplier].currentValues.length >= increment) {
			let avg = _.sum(memory[multiplier].currentValues);
			avg /= memory[multiplier].currentValues.length;

			stats.saveStatValue(memory, multiplier * increment, avg);

			memory[multiplier].previousValues = memory[multiplier].currentValues;
			memory[multiplier].currentValues = [];
		}

		memory[multiplier].currentValues.push(value);
	},

	/**
	 * Retrieves long term history data.
	 *
	 * @param {string} key
	 *   Identifier of the information to retreive.
	 * @param {number} interval
	 *   Interval for which to retreive the data. Needs to be a power of 10.
	 *
	 * @return {number}
	 *   Average value of the given stat during the requested interval.
	 */
	getStat(key, interval) {
		// @todo Allow intervals that are not directly stored, like 300.
		if (!Memory.history || !Memory.history[key] || !Memory.history[key][interval]) {
			return null;
		}

		return _.last(Memory.history[key][interval].currentValues);
	},
};

module.exports = stats;
