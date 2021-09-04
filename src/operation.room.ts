import Operation from 'operation';

export default class RoomOperation extends Operation {
	constructor(name) {
		super(name);
		this.memory.type = 'room';
	}
};
