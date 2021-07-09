'use strict';

const Operation = require('./operation');

module.exports = class RoomOperation extends Operation {
	constructor(name) {
		super(name);
		this.memory.type = 'room';
	}
};
