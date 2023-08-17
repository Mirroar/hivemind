import localRelations from 'relations.local';
import settings from 'settings-manager';

export default class Relations {
	readonly allies: string[];
	readonly enemies: string[];

	/**
	 * Relations determine how we act towards other users.
	 * @constructor
	 */
	constructor() {
		this.allies = [];
		this.enemies = [];

		if (localRelations?.allies) {
			for (const ally of localRelations.allies) {
				this.allies.push(ally);
			}
		}

		if (localRelations?.enemies) {
			for (const enemy of localRelations.enemies) {
				this.enemies.push(enemy);
			}
		}
	}

	/**
	 * Checks if a user is considered our ally.
	 *
	 * @param {string} username
	 *   The name of the user to check.
	 *
	 * @return {boolean} true if the user is our ally.
	 */
	isAlly(username: string): boolean {
		return username && this.allies.includes(username);
	}

	/**
	 * Checks if a user is considered our enemy.
	 *
	 * @param {string} username
	 *   The name of the user to check.
	 *
	 * @return {boolean} true if the user is our enemy.
	 */
	isEnemy(username: string): boolean {
		if (settings.get('treatNonAlliesAsEnemies')) return !this.isAlly(username);

		if (username === 'Invader' || username === 'Source Keeper' || username === SYSTEM_USERNAME) return true;

		return this.enemies.includes(username);
	}
}
