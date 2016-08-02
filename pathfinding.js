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
