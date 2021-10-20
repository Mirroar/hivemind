const MockHivemind = function () {};

MockHivemind.prototype.log = function () {
	return {
		debug() {},
		info() {},
		error() {},
	};
};

export default MockHivemind;
