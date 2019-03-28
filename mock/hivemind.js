'use strict';

const MockHivemind = function () {};

MockHivemind.prototype.log = function () {
	return {
		debug() {},
		info() {},
		error() {},
	};
};

module.exports = MockHivemind;
