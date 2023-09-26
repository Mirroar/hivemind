import Process from 'process/process';
import hivemind from 'hivemind';

export default class CleanupProcess extends Process {
	memory: {
		constructionSites: Record<string, {
			progress: number;
			time: number;
		}>;
	};

	/**
	 * Sends regular email reports about routine stats.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(parameters: ProcessParameters) {
		super(parameters);

		if (!hivemind.segmentMemory.has('process:cleanup')) {
			hivemind.segmentMemory.set('process:cleanup', {
				constructionSites: {},
			});
		}

		this.memory = hivemind.segmentMemory.get('process:cleanup');
	}

	/**
	 * Runs the process.
	 */
	run() {
		this.cleanupConstructionSites();
		this.cleanupConstructionSiteMemory();
	}

	/**
	 * Checks for construction sites that are no longer being built.
	 */
	cleanupConstructionSites() {
		for (const id in Game.constructionSites) {
			const site = Game.constructionSites[id];
			this.removeConstructionSiteIfExpired(site);
		}
	}

	/**
	 * Removes a construction site if it has been inactive.
	 */
	removeConstructionSiteIfExpired(site: ConstructionSite) {
		const timeToLive = this.getTimeToLive(site);
		let lastProgressTime = Game.time;
		if (this.memory.constructionSites[site.id]) {
			const hasNotProgressed = this.memory.constructionSites[site.id].progress === site.progress;
			lastProgressTime = hasNotProgressed ? this.memory.constructionSites[site.id].time : Game.time;
		}

		if (Game.time - lastProgressTime >= timeToLive) {
			site.remove();
			delete this.memory.constructionSites[site.id];
		}
		else {
			this.memory.constructionSites[site.id] = {
				progress: site.progress,
				time: lastProgressTime,
			};
		}
	}

	/**
	 * Gets the time we allow a construction site to remain without progressing.
	 */
	getTimeToLive(site: ConstructionSite): number {
		let ttl = site.progress;
		if (site.room) {
			ttl += 2000;
			if (site.room.isMine()) ttl += 20_000;
		}

		return ttl;
	}

	/**
	 * Removes entries from memory if a construction site no longer exists.
	 */
	cleanupConstructionSiteMemory() {
		for (const id in this.memory.constructionSites) {
			if (!Game.getObjectById(id)) delete this.memory.constructionSites[id];
		}
	}
}
