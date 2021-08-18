/**
 * Relations determine how we act towards other users.
 * @constructor
 */
const Relations = function () {
	this.allies = [];

	try {
		import localRelations from './relations.local';

		if (localRelations.allies) {
			for (const ally of localRelations.allies) {
				this.allies.push(ally);
			}
		}
	}
	catch (error) {
		// No local relations declared, ignore.
	}
};

/**
 * Checks if a user is considered our ally.
 *
 * @param {string} username
 *   The name of the user to check.
 *
 * @return {boolean} true if the user is our ally.
 */
Relations.prototype.isAlly = function (username) {
	return this.allies.indexOf(username) !== -1;
};

export default Relations;
