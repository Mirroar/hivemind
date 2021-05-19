'use strict';

/* global hivemind */

const heapCache = {};

const cache = {
	/**
	 * Caches arbitrary data in heap memory for some time.
	 *
	 * @param {string} cacheKey
	 *   Name of the requested cache bin.
	 * @param {number} maxAge
	 *   Maximum age of cached data in ticks.
	 * @param {function} generateCallback
	 *   Callback to generate the cached data.
	 *
	 * @return {Object}
	 *   The requested cache object.
	 */
	inHeap(cacheKey, maxAge, generateCallback) {
		return cache.inObject(heapCache, cacheKey, maxAge, generateCallback);
	},

	/**
	 * Caches arbitrary data in persistent memory for some time.
	 *
	 * @param {string} cacheKey
	 *   Name of the requested cache bin.
	 * @param {number} maxAge
	 *   Maximum age of cached data in ticks.
	 * @param {function} generateCallback
	 *   Callback to generate the cached data.
	 *
	 * @return {Object}
	 *   The requested cache object.
	 */
	inMemory(cacheKey, maxAge, generateCallback) {
		return cache.inObject(Memory, cacheKey, maxAge, generateCallback);
	},

	/**
	 * Caches arbitrary data in an object's heap memory for some time.
	 *
	 * @param {object} o
	 *   The object the data is attached to.
	 * @param {string} cacheKey
	 *   Name of the requested cache bin.
	 * @param {number} maxAge
	 *   Maximum age of cached data in ticks.
	 * @param {function} generateCallback
	 *   Callback to generate the cached data.
	 *
	 * @return {Object}
	 *   The requested cache object.
	 */
	inObject(o, cacheKey, maxAge, generateCallback) {
		if (!o._cache) o._cache = {};
		if (!o._cache[cacheKey] || Game.time - o._cache[cacheKey].created > maxAge * hivemind.getThrottleMultiplier()) {
			const data = generateCallback ? generateCallback(o._cache[cacheKey]) : {};

			o._cache[cacheKey] = {
				data,
				maxAge,
				created: Game.time,
			};
		}

		return o._cache[cacheKey].data;
	},

	/**
	 * Clears cache entries that are stale.
	 *
	 * @param {object} o
	 *   The object to collect garbage on. If not given, the general heap cache is
	 *   garbage collected.
	 */
	collectGarbage(o) {
		if (!o) o = heapCache;

		for (const key in o._cache || {}) {
			if (Game.time - o._cache[key].created < 2 * o._cache[key].maxAge) continue;

			delete o._cache[key];
		}
	},
};

module.exports = cache;
