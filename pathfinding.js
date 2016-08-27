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
        lastPositions: {},
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
                if (pos.roomName != this.room.name) return false;
                if (pos.x == 0 || pos.x == 49 || pos.y == 0 || pos.y == 49) {
                    return false;
                }

                // Only try to get to paths where no creep is positioned.
                var found = pos.lookFor(LOOK_CREEPS);
                var found2 = pos.lookFor(LOOK_STRUCTURES);
                var found3 = pos.lookFor(LOOK_CONSTRUCTION_SITES);

                var blocked = found.length > 0 && found[0].name != this.name;
                for (let i in found2) {
                    if (found2[i].structureType != STRUCTURE_ROAD && found2[i].structureType != STRUCTURE_CONTAINER) {
                        blocked = true;
                    }
                }
                for (let i in found3) {
                    if (found3[i].structureType != STRUCTURE_ROAD && found3[i].structureType != STRUCTURE_CONTAINER) {
                        blocked = true;
                    }
                }

                return !blocked;
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
        if (afterNext && afterNext.roomName == this.pos.roomName && afterNext.getRangeTo(this.pos) <= 1) {
            this.memory.cachedPath.position += 2;

            //console.log('path room switch', this.name, this.memory.cachedPath.position);
        }
        else if (!afterNext) {
            delete this.memory.cachedPath.forceGoTo;
            delete this.memory.cachedPath.lastPositions;
        }
        /*else if (!afterNext) {
            console.log(this.name, 'stuck?');
            this.move(_.random(1, 8));
            return;
            //this.memory.cachedPath.position += 1;
        }//*/
    }

    this.say('Pos: ' + this.memory.cachedPath.position);

    // @todo Check if we've been blocked for a while and try to move around the blockade.
    // Check if we've moved at all during the previous ticks.
    if (!this.memory.cachedPath.lastPositions) {
        this.memory.cachedPath.lastPositions = {};
    }
    this.memory.cachedPath.lastPositions[Game.time % 5] = utilities.encodePosition(this.pos);

    let stuck = false;
    if (_.size(this.memory.cachedPath.lastPositions) > 5 / 2) {
        let last = null;
        stuck = true;
        for (let i in this.memory.cachedPath.lastPositions) {
            if (!last) {
                last = this.memory.cachedPath.lastPositions[i];
            }
            if (last != this.memory.cachedPath.lastPositions[i]) {
                stuck = false;
                break;
            }
        }
    }
    if (stuck) {
        //console.log(this.name, 'has been stuck for the last', _.size(this.memory.cachedPath.lastPositions), 'ticks. Trying to go around blockade.');
        let i = this.memory.cachedPath.position + 1;
        while (i < path.length) {
            if (path[i].roomName != this.pos.roomName) {
                // Skip past exit tile in next room.
                i++;
                break;
            }

            // Only try to get to paths where no creep is positioned.
            var found = path[i].lookFor(LOOK_CREEPS);
            var found2 = path[i].lookFor(LOOK_STRUCTURES);
            var found3 = path[i].lookFor(LOOK_CONSTRUCTION_SITES);

            var blocked = found.length > 0 && found[0].name != this.name;
            for (let i in found2) {
                if (found2[i].structureType != STRUCTURE_ROAD && found2[i].structureType != STRUCTURE_CONTAINER) {
                    blocked = true;
                }
            }
            for (let i in found3) {
                if (found3[i].structureType != STRUCTURE_ROAD && found3[i].structureType != STRUCTURE_CONTAINER) {
                    blocked = true;
                }
            }

            if (!blocked) break;

            i++;
        }

        if (i >= path.length) {
            // No free spots until end of path. Let normal pathfinder take ofer.
            this.memory.cachedPath.arrived = true;
            return;
        }
        else {
            //console.log(this.name, 'going to pos', i);
            this.memory.cachedPath.forceGoTo = i;
            delete this.memory.cachedPath.lastPositions;
        }
    }

    // Check if we've arrived at the end of our path.
    if (this.memory.cachedPath.position >= path.length - 1) {
        this.memory.cachedPath.arrived = true;
        return;
    }

    // Go around obstacles if necessary.
    if (this.memory.cachedPath.forceGoTo) {
        let pos = path[this.memory.cachedPath.forceGoTo];

        if (this.pos.getRangeTo(pos) > 0) {
            this.say('Skip:' + this.memory.cachedPath.forceGoTo);
            this.moveTo(pos);
            return;
        }
        else {
            this.memory.cachedPath.position = this.memory.cachedPath.forceGoTo;
            delete this.memory.cachedPath.forceGoTo;
        }
    }

    // Move towards next position.
    next = path[this.memory.cachedPath.position + 1];
    if (!next) {
        // Out of range, so we're probably at the end of the path.
        this.memory.cachedPath.arrived = true;
        return;
    }

    if (next.roomName != this.pos.roomName) {
        // Something went wrong, we must have gone off the path.
        delete this.memory.cachedPath.position;
        //console.log('path reeinitialize', this.name);
        return;
    }

    let direction = this.pos.getDirectionTo(next);
    this.move(direction);
};
