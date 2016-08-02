var utilities = require('utilities');

/**
 * Serializes an array of RoomPosition objects for storing in memory.
 */
Room.serializePositionPath = function (path) {
    var result = [];
    for (var i in path) {
        result.push(utilities.encodePosition(path[i]));
    }

    return result;
};

/**
 * Deserializes a serialized path into an array of RoomPosition objects.
 */
Room.deserializePositionPath = function (path) {
    var result = [];
    for (var i in path) {
        result.push(utilities.decodePosition(path[i]));
    }

    return result;
};

/**
 * Saves a cached path in a creeps memory for use.
 */
Creep.prototype.setCachedPath = function (path, reverse, distance) {
    path = _.clone(path);
    if (reverse) {
        path.reverse();
    }
    if (distance) {
        for (let i = 0; i < distance; i++) {
            path.pop();
        }
    }
    this.memory.cachedPath = {
        path: path,
        position: null,
        arrived: false,
    };
};

/**
 * Checks if a creep has a path stored.
 */
Creep.prototype.hasCachedPath = function () {
    return this.memory.cachedPath;
};

/**
 * Clears a creep's stored path.
 */
Creep.prototype.clearCachedPath = function () {
    delete this.memory.cachedPath;
};

/**
 * Checks if a creep has finished traversing it's stored path.
 */
Creep.prototype.hasArrived = function () {
    return this.memory.cachedPath && this.memory.cachedPath.arrived;
};

/**
 * Makes a creep follow it's cached path until the end.
 */
Creep.prototype.followCachedPath = function () {
    var path = Room.deserializePositionPath(this.memory.cachedPath.path);
    if (!this.memory.cachedPath.position) {
        let target = this.pos.findClosestByRange(path, {
            filter: (pos) => {
                // Only try to get to paths where no creep is positioned.
                var found = pos.lookFor(LOOK_CREEPS);

                return (found.length < 1 || found[0].name == this.name) && pos.roomName == this.pos.roomName;
            }
        });
        if (!target) {
            // We're not in the correct room to move on this path. Kind of sucks, but try to get there using the default pathfinder anyway.
            this.moveTo(path[0]);
            this.say('Searching');
            return;
        }
        else {
            // Try to get to the closest part of the path.
            if (this.pos.x == target.x && this.pos.y == target.y) {
                // We've arrived on the path, time to get moving along it!
                for (let i in path) {
                    if (this.pos.x == path[i].x && this.pos.y == path[i].y && this.pos.roomName == path[i].roomName) {
                        this.memory.cachedPath.position = i;
                        break;
                    }
                }
                if (!this.memory.cachedPath.position) {
                    return;
                }
            }
            else {
                // Get closer to the path.
                this.moveTo(target);
                this.say('getonit');
                return;
            }
        }
    }

    // Make sure we don't have a string on our hands...
    this.memory.cachedPath.position = this.memory.cachedPath.position * 1;

    // Check if we've already moved onto the next position.
    let next = path[this.memory.cachedPath.position + 1];
    if (!next) {
        // Out of range, so we're probably at the end of the path.
        this.memory.cachedPath.arrived = true;
        return;
    }

    if (next.x == this.pos.x && next.y == this.pos.y) {
        this.memory.cachedPath.position++;
    }
    else if (next.roomName != this.pos.roomName) {
        // We just changed rooms.
        let afterNext = path[this.memory.cachedPath.position + 2];
        if (afterNext.roomName == this.pos.roomName && afterNext.getRangeTo(this.pos) <= 1) {
            this.memory.cachedPath.position += 2;

            //console.log('path room switch', this.name, this.memory.cachedPath.position);
        }
    }

    this.say('Pos: ' + this.memory.cachedPath.position);

    // Check if we've arrived at the end of our path.
    if (this.memory.cachedPath.position >= path.length - 1) {
        this.memory.cachedPath.arrived = true;
        return;
    }

    // @todo Check if we've been blocked for a while and try to move around the blockade.

    // Move towards next position.
    next = path[this.memory.cachedPath.position + 1];

    if (next.roomName != this.pos.roomName) {
        // Something went wrong, we must have gone off the path.
        delete this.memory.cachedPath.position;
        console.log('path reeinitialize', this.name);
        return;
    }

    let direction = this.pos.getDirectionTo(next);
    this.move(direction);
};
