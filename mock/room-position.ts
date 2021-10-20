/**
 * Creates a new RoomPosition object.
 * @constructor
 *
 * @param {number} x
 *   x position.
 * @param {number} y
 *   y position.
 * @param {string} roomName
 *   Name of the room.
 */
const RoomPosition = function (this: RoomPosition, x: number, y: number, roomName: string) {
	this.x = Number(x);
	this.y = Number(y);
	this.roomName = roomName;
};

export default RoomPosition;
