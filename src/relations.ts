import localRelations from 'relations.local';

export default class Relations {
	allies: string[];

	/**
	 * Relations determine how we act towards other users.
	 * @constructor
	 */
	constructor() {
		this.allies = [];

		if (localRelations && localRelations.allies) {
			for (const ally of localRelations.allies) {
				this.allies.push(ally);
			}
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
	isAlly(username: string): boolean {
		return this.allies.indexOf(username) !== -1;
	};
}
