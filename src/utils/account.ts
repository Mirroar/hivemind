
let ownUserName;

/**
 * Dynamically determines the username of the current user.
 *
 * @return {string}
 *   The determined user name.
 */
function getUsername(): string {
	if (ownUserName) return ownUserName;

	if (_.size(Game.spawns) === 0) {
		if (_.size(Game.creeps) === 0) return '@undefined';

		ownUserName = _.sample(Game.creeps).owner.username;
		return ownUserName;
	}

	ownUserName = _.sample(Game.spawns).owner.username;
	return ownUserName;
}

export {
	getUsername,
};
