/* global RESOURCE_POWER */

import Process from 'process/process';

export default class ReportProcess extends Process {
	memory;

	/**
	 * Sends regular email reports about routine stats.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		super(params, data);

		if (!Memory.strategy.reports) this.initMemory((new Date()).getTime());
		this.memory = Memory.strategy.reports;
	};

	/**
	 * (Re-)initializes report memory.
	 *
	 * @param {Number} baseTimestamp
	 *   Timestamp in milliseconds that marks the start of this reporting period.
	 */
	initMemory(baseTimestamp) {
		Memory.strategy.reports = {
			nextReportTime: this.normalizeDate(new Date(baseTimestamp + (24 * 60 * 60 * 1000))).getTime(),
			data: {
				time: Game.time,
				gcl: Game.gcl,
				gpl: Game.gpl,
				power: [],
				storedPower: this.getStoredPower(),
				remoteHarvestCount: Memory.strategy.remoteHarvesting.currentCount,
				cpu: {},
			},
		};

		// @todo Add stats about total stored resources.
		// @todo Add stats about room levels to report level ups?

		// Update reference to memory.
		this.memory = Memory.strategy.reports;
	};

	/**
	 * Sends regular email reports.
	 */
	run() {
		// Check if it's time for sending a report.
		if ((new Date()).getTime() < this.memory.nextReportTime) return;

		this.generateReport();
		this.initMemory(this.memory.nextReportTime);
	};

	/**
	 * Normalizes a date object so that it points to 8:00 UTC on the given day.
	 *
	 * @param {Date} date
	 *   The date object to modify.
	 * @return {Date}
	 *   The modified date object.
	 */
	normalizeDate(date) {
		date.setMilliseconds(0);
		date.setSeconds(0);
		date.setMinutes(0);
		date.setUTCHours(8);

		return date;
	};

	/**
	 * Generates and sends a report email.
	 */
	generateReport() {
		this.generateLevelReport('gcl', 'Control Points');
		this.generateLevelReport('gpl', 'Power');
		this.generateCPUReport();
		this.generateRemoteMiningReport();
		this.generatePowerReport();

		// @todo Report market transactions.
		// @todo Generate report for CPU usage and bucket.
	};

	/**
	 * Generates report email for gcl / gpl changes.
	 *
	 * @param {String} variable
	 *   Variable to report. Must be either 'gcl' or 'gpl'.
	 * @param {String} label
	 *   Label of the heading for the generated report section.
	 */
	generateLevelReport(variable, label) {
		const previousValues = this.memory.data[variable];
		const currentValues = Game[variable];

		let reportText = this.generateHeading(label);
		let pointsDiff = currentValues.progress - previousValues.progress;
		const tickDiff = Game.time - this.memory.data.time;
		reportText += 'Level: ' + currentValues.level;
		if (currentValues.level > previousValues.level) {
			reportText += ' (+' + (currentValues.level - previousValues.level) + ')';
			pointsDiff += previousValues.progressTotal;
		}

		reportText += '\nProgress: ' + (100 * currentValues.progress / currentValues.progressTotal).toPrecision(3) + '% (+' + (100 * pointsDiff / currentValues.progressTotal).toPrecision(3) + '% @ ' + (pointsDiff / tickDiff).toPrecision(3) + '/tick)';

		Game.notify(reportText);
	};

	/**
	 * Generates report email for power harvesting.
	 */
	generatePowerReport() {
		let reportText = this.generateHeading('⚡ Power gathering');

		let totalAmount = 0;
		let totalRooms = 0;
		for (const intent of this.memory.data.power || []) {
			totalRooms++;
			totalAmount += intent.info.amount || 0;
		}

		if (totalRooms === 0) return;

		reportText += 'Started gathering ' + totalAmount + ' power in ' + totalRooms + ' rooms.<br>';
		reportText += 'Stored: ' + this.getStoredPower() + ' (+' + (this.getStoredPower() - (this.memory.data.storedPower || 0)) + ')';

		Game.notify(reportText);
	};

	/**
	 * Gets the amount of power in storage across owned rooms.
	 *
	 * @return {number}
	 *   Global amount of stored power.
	 */
	getStoredPower() {
		let amount = 0;
		for (const room of Game.myRooms) {
			amount += room.storage ? (room.storage.store[RESOURCE_POWER] || 0) : 0;
			amount += room.terminal ? (room.terminal.store[RESOURCE_POWER] || 0) : 0;
		}

		return amount;
	};

	/**
	 * Generates report email for CPU stats.
	 */
	generateCPUReport() {
		let reportText = this.generateHeading('💻 CPU Usage');

		const values = this.memory.data.cpu;
		const buckedAverage = values.bucket / values.totalTicks;
		const cpuAverage = values.cpu / values.totalTicks;
		const cpuTotalAverage = values.cpuTotal / values.totalTicks;
		const cpuPercent = 100 * cpuAverage / cpuTotalAverage;

		reportText += 'Bucket: ' + buckedAverage.toPrecision(4) + '<br>';
		reportText += 'CPU: ' + cpuAverage.toPrecision(3) + '/' + cpuTotalAverage.toPrecision(3) + ' (' + cpuPercent.toPrecision(3) + '%)<br>';

		Game.notify(reportText);
	};

	/**
	 * Generates report email for remote mining.
	 */
	generateRemoteMiningReport() {
		let reportText = this.generateHeading('⚒ Remote mining');

		reportText += 'Remote mining in ' + Memory.strategy.remoteHarvesting.currentCount + ' rooms';
		if (Memory.strategy.remoteHarvesting.currentCount > this.memory.data.remoteHarvestCount) {
			reportText += ' (+' + (Memory.strategy.remoteHarvesting.currentCount - this.memory.data.remoteHarvestCount) + ')';
		}
		else if (Memory.strategy.remoteHarvesting.currentCount < this.memory.data.remoteHarvestCount) {
			reportText += ' (-' + (this.memory.data.remoteHarvestCount - Memory.strategy.remoteHarvesting.currentCount) + ')';
		}

		Game.notify(reportText);
	};

	/**
	 * Generates a formatted heading.
	 *
	 * @param {String} text
	 *   Text to use inside the heading.
	 *
	 * @return {String}
	 *   The formatted heading.
	 */
	generateHeading(text) {
		return '<h3>' + text + '</h3>';
	};
}
