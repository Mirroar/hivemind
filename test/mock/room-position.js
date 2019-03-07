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
const RoomPosition = function (x, y, roomName) {
	this.x = Number(x);
	this.y = Number(y);
	this.roomName = roomName;
};

module.exports = RoomPosition;
