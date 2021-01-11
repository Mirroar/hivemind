'use strict';

/* global Game Memory */

const Process = require('./process');

/**
 * Sends regular email reports about routine stats.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ReportProcess = function (params, data) {
	Process.call(this, params, data);

	if (!Memory.strategy.report) this.initMemory();
	this.memory = Memory.strategy.reports;
};

ReportProcess.prototype = Object.create(Process.prototype);

ReportProcess.prototype.initMemory = function () {
	Memory.strategy.reports = {
		nextReportTime: this.normalizeDate(new Date()).getTime(),
		data: {
			time: Game.time,
			gcl: Game.gcl,
			gpl: Game.gpl,
		},
	};

	// @todo Add stats about total stored resources.
	// @todo Add stats about room levels to report level ups?
};

/**
 * Sends regular email reports.
 */
ReportProcess.prototype.run = function () {
	// Check if it's time for sending a report.
	if ((new Date()).getTime() < this.memory.nextReportTime) return;

	this.generateReport();
	const lastReportTime = this.memory.nextReportTime;
	this.initMemory();

	// Set time of next report.
	this.memory.nextReportTime = this.normalizeDate(new Date(lastReportTime + (24 * 60 * 60 * 1000))).getTime();
};

/**
 * Normalizes a date object so that it points to 8:00 UTC on the given day.
 *
 * @param {Date} date
 *   The date object to modify.
 * @return {Date}
 *   The modified date object.
 */
ReportProcess.prototype.normalizeDate = function (date) {
	date.setMilliseconds(0);
	date.setSeconds(0);
	date.setMinutes(0);
	date.setUTCHours(8);

	return date;
};

/**
 * Generates and sends a report email.
 */
ReportProcess.prototype.generateReport = function () {
	this.generateLevelReport('gcl', 'Control Points');
	this.generateLevelReport('gpl', 'Power');
};

/**
 * Generates report email for gcl / gpc changes.
 *
 * @param {String} variable
 *   Variable to report. Must be either 'gcl' or 'gpl'.
 * @param {String} label
 *   Label of the heading for the generated report section.
 */
ReportProcess.prototype.generateLevelReport = function (variable, label) {
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

	reportText += '\nPoints: ' + currentValues.progress + ' (+' + pointsDiff + ' @ ' + (pointsDiff / tickDiff).toPrecision(4) + '/tick)';

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
ReportProcess.prototype.generateHeading = function (text) {
	return '<h3>' + text + '</h3>';
};

module.exports = ReportProcess;
