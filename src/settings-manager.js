'use strict';

module.exports = class SettingsManager {
	/**
	 * Creates a new SettingsManager instance.
	 *
	 * Settings values will be loaded from files an memory at this point.
	 */
	constructor() {
		// Load base settings.
		this.values = require('./settings.default');

		// Add user settings from file.
		try {
			const localSettings = require('./settings.local');

			if (localSettings) {
				_.each(localSettings, (value, key) => {
					if (typeof this.values[key] === 'undefined') return;

					this.values[key] = value;
				});
			}
		}
		catch (error) {
			// No local settings declared, ignore the error.
		}

		// Add user settings from memory.
		if (Memory.hivemind && Memory.hivemind.settings) {
			_.each(Memory.hivemind.settings, (value, key) => {
				if (typeof this.values[key] === 'undefined') return;

				this.values[key] = value;
			});
		}
	}

	/**
	 * Gets the value for a setting.
	 *
	 * @param {string} key
	 *   The key for the setting to get.
	 *
	 * @return {mixed}
	 *   The value for this setting.
	 */
	get(key) {
		// @todo Periodically check if a setting was changed in memory.
		return this.values[key];
	}

	/**
	 * Overrides the value for a setting in persistent memory.
	 *
	 * @param {string} key
	 *   The key for the setting to set.
	 * @param {string} value
	 *   The value for the setting to set.
	 */
	set(key, value) {
		if (typeof this.values[key] === 'undefined') return;
		if (typeof value === 'undefined') return;
		if (!Memory.hivemind.settings) Memory.hivemind.settings = {};

		this.values[key] = value;
		Memory.hivemind.settings[key] = value;
	}

	/**
	 * Removes memory override for a setting.
	 *
	 * @param {string} key
	 *   The key for the setting to reset.
	 */
	reset(key) {
		// @todo Reload values from local or base settings.
		if (typeof this.values[key] === 'undefined') return;
		if (!Memory.hivemind.settings) return;

		delete Memory.hivemind.settings[key];
	}
};
