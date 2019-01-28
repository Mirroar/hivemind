'use strict';

/* global hivemind Creep StructureController FIND_HOSTILE_CREEPS
STRUCTURE_CONTROLLER STRUCTURE_STORAGE STRUCTURE_SPAWN STRUCTURE_TOWER
LOOK_STRUCTURES FIND_STRUCTURES FIND_MY_CREEPS CREEP_LIFE_TIME
FIND_HOSTILE_STRUCTURES OK STRUCTURE_TERMINAL */

const utilities = require('./utilities');

/**
 * Get a priority list of military targets for this creep.
 */
Creep.prototype.getAvailableMilitaryTargets = function () {
	const creep = this;
	const options = [];

	if (creep.memory.target) {
		const targetPosition = utilities.decodePosition(creep.memory.target);
		if (!targetPosition) {
			delete creep.memory.target;
			return options;
		}

		if (creep.pos.roomName === targetPosition.roomName) {
			// Find enemies to attack.
			if (creep.memory.body.attack) {
				const enemies = creep.room.find(FIND_HOSTILE_CREEPS);

				if (enemies && enemies.length > 0) {
					for (const i in enemies) {
						const enemy = enemies[i];

						// Check if enemy is harmless, and ignore it.
						if (!enemy.isDangerous()) continue;

						const option = {
							priority: 5,
							weight: 1 - (creep.pos.getRangeTo(enemy) / 50),
							type: 'hostilecreep',
							object: enemy,
						};

						// @todo Calculate weight / priority from distance, HP left, parts.

						options.push(option);
					}
				}

				// Find structures to attack.
				let structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
					filter: structure => structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_STORAGE && structure.hits,
				});
				if (!creep.room.controller || !creep.room.controller.owner || hivemind.relations.isAlly(creep.room.controller.owner.username)) structures = [];

				// Attack structures under target flag (even if non-hostile, like walls).
				const directStrutures = targetPosition.lookFor(LOOK_STRUCTURES);
				for (const i in directStrutures || []) {
					structures.push(directStrutures[i]);
				}

				if (structures && structures.length > 0) {
					for (const i in structures) {
						const structure = structures[i];

						const option = {
							priority: 2,
							weight: 0,
							type: 'hostilestructure',
							object: structure,
						};

						// @todo Calculate weight / priority from distance, HP left, parts.
						if (structure.structureType === STRUCTURE_SPAWN) {
							option.priority = 4;
						}

						if (structure.structureType === STRUCTURE_TOWER) {
							option.priority = 3;
						}

						options.push(option);
					}
				}

				// Find walls in front of controller.
				if (creep.room.controller && creep.room.controller.owner && !creep.room.controller.my) {
					const structures = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
						filter: structure => structure.structureType !== STRUCTURE_CONTROLLER,
					});

					if (structures && structures.length > 0) {
						for (const i in structures) {
							const structure = structures[i];

							const option = {
								priority: 0,
								weight: 0,
								type: 'hostilestructure',
								object: structure,
							};

							options.push(option);
						}
					}
				}
			}

			// Find friendlies to heal.
			if (creep.memory.body.heal) {
				let damaged = creep.room.find(FIND_MY_CREEPS, {
					filter: friendly => ((friendly.id !== creep.id) && (friendly.hits < friendly.hitsMax)),
				});
				if (_.size(damaged) === 0) {
					damaged = creep.room.find(FIND_HOSTILE_CREEPS, {
						filter: friendly => ((friendly.id !== creep.id) && (friendly.hits < friendly.hitsMax) && hivemind.relations.isAlly(friendly.owner.username)),
					});
				}

				if (damaged && damaged.length > 0) {
					for (const i in damaged) {
						const friendly = damaged[i];

						const option = {
							priority: 3,
							weight: 0,
							type: 'creep',
							object: friendly,
						};

						// @todo Calculate weight / priority from distance, HP left, parts.

						options.push(option);
					}
				}
			}

			// Attack / Reserve controllers.
			if (creep.memory.body.claim && creep.memory.body.claim >= 5) {
				if (creep.room.controller.owner && !creep.room.controller.my) {
					options.push({
						priority: 5,
						weight: 0,
						type: 'controller',
						object: creep.room.controller,
					});
				}
			}

			if (creep.memory.body.claim && !creep.room.controller.owner) {
				options.push({
					priority: 4,
					weight: 0,
					type: 'controller',
					object: creep.room.controller,
				});
			}

			// @todo Run home for healing if no functional parts are left.
		}
	}

	return options;
};

/**
 * Sets a good military target for this creep.
 */
Creep.prototype.calculateMilitaryTarget = function () {
	const creep = this;
	const best = utilities.getBestOption(creep.getAvailableMilitaryTargets());

	if (best) {
		let action = 'heal';
		if (best.type === 'hostilecreep' || best.type === 'hostilestructure') {
			action = 'attack';
		}
		else if (best.type === 'controller') {
			action = 'claim';
		}

		creep.memory.order = {
			type: action,
			target: best.object.id,
		};
	}
	else {
		delete creep.memory.order;
	}
};

/**
 * Potentially modifies a creep when target room has been reached.
 */
Creep.prototype.militaryRoomReached = function () {
	if (this.memory.squadUnitType === 'builder') {
		// Rebrand as remote builder to work in this room from now on.
		this.memory.role = 'builder.remote';
		this.memory.target = utilities.encodePosition(this.pos);
		this.memory.starting = false;
		this.memory.singleRoom = this.pos.roomName;
	}
};

/**
 * Makes a creep move towards its designated target.
 */
Creep.prototype.performMilitaryMove = function () {
	const creep = this;

	if (this.memory.fillWithEnergy) {
		if (_.sum(this.carry) < this.carryCapacity) {
			this.performGetEnergy();
			return true;
		}

		delete this.memory.fillWithEnergy;
	}

	if (this.memory.pathName) {
		// @todo Decide if squad should be fully spawned / have an order or attack flag before moving along path.
		const flagName = 'Path:' + this.memory.pathName + ':' + this.memory.pathStep;
		const flag = Game.flags[flagName];

		if (flag) {
			this.moveTo(flag);
			if (this.pos.getRangeTo(flag) < 5) {
				console.log(this.name, 'reached waypoint', this.memory.pathStep, 'of path', this.memory.pathName, 'and has', this.ticksToLive, 'ticks left to live.');

				this.memory.pathStep++;
			}

			return true;
		}

		console.log(this.name, 'reached end of path', this.memory.pathName, 'at step', this.memory.pathStep, 'and has', this.ticksToLive, 'ticks left to live.');

		delete this.memory.pathName;
		delete this.memory.pathStep;

		this.militaryRoomReached();
	}

	if (this.memory.exploitName) {
		const exploit = Game.exploits[this.memory.exploitName];
		if (exploit) {
			// If an enemy is close by, move to attack it.
			const enemies = this.pos.findInRange(FIND_HOSTILE_CREEPS, 10, {
				filter: enemy => enemy.isDangerous(),
			});
			if (enemies.length > 0) {
				this.memory.exploitTarget = enemies[0].id;
				this.moveTo(enemies[0]);
				return;
			}

			if (this.memory.exploitTarget) {
				const target = Game.getObjectById(this.memory.exploitTarget);

				if (target) {
					this.moveTo(target);
					return;
				}

				delete this.memory.exploitTarget;
			}

			// Clear cached path if we've gotton close to goal.
			if (this.memory.patrolPoint && this.hasCachedPath()) {
				const lair = Game.getObjectById(this.memory.patrolPoint);
				if (this.pos.getRangeTo(lair) <= 7) {
					this.clearCachedPath();
				}
			}

			// Follow cached path when requested.
			if (this.hasCachedPath()) {
				this.followCachedPath();
				if (this.hasArrived()) {
					this.clearCachedPath();
				}
				else {
					return;
				}
			}

			if (this.pos.roomName === exploit.roomName) {
				// In-room movement.

				// Start at closest patrol point to entrance
				if (!this.memory.patrolPoint) {
					if (exploit.memory.closestLairToEntrance) {
						this.memory.patrolPoint = exploit.memory.closestLairToEntrance;
					}
					else if (exploit.memory.lairs) {
						for (const id in exploit.memory.lairs) {
							this.memory.patrolPoint = id;
							break;
						}
					}
				}

				if (this.memory.patrolPoint) {
					this.memory.target = this.memory.patrolPoint;
					const lair = Game.getObjectById(this.memory.patrolPoint);
					if (!lair) return;

					// Seems we have arrived at a patrol Point, and no enemies are immediately nearby.
					// Find patrol point where we'll have the soonest fight.
					let best = null;
					let bestTime = null;

					const id = this.memory.patrolPoint;
					for (const id2 in exploit.memory.lairs) {
						const otherLair = Game.getObjectById(id2);
						if (!otherLair) continue;

						let time = otherLair.ticksToSpawn || 0;

						if (id !== id2) {
							if (exploit.memory.lairs[id].paths[id2].path) {
								time = Math.max(time, exploit.memory.lairs[id].paths[id2].path.length);
							}
							else {
								time = Math.max(time, exploit.memory.lairs[id2].paths[id].path.length);
							}
						}

						if (!best || time < bestTime) {
							best = id2;
							bestTime = time;
						}
					}

					if (best) {
						if (best === this.memory.patrolPoint) {
							// We're at the correct control point. Move to intercept potentially spawning source keepers.
							if (exploit.memory.lairs[best].sourcePath) {
								this.moveTo(utilities.decodePosition(exploit.memory.lairs[best].sourcePath.path[1]));
							}
							else {
								this.moveToRange(lair, 1);
							}
						}
						else {
							this.memory.patrolPoint = best;
							if (exploit.memory.lairs[id].paths[best].path) {
								this.setCachedPath(exploit.memory.lairs[id].paths[best].path, false, 3);
							}
							else {
								this.setCachedPath(exploit.memory.lairs[best].paths[id].path, true, 3);
							}
						}
					}

					return;
				}

				// @todo No patrol points available, what now?
			}
			else if (!this.hasCachedPath() && exploit.memory.pathToRoom) {
				// Follow cached path to target room.
				this.setCachedPath(exploit.memory.pathToRoom);
				return;
			}
		}
	}

	if (creep.memory.squadName) {
		// Check if there are orders and set a target accordingly.
		const squad = Game.squads[creep.memory.squadName];
		if (squad) {
			const orders = squad.getOrders();
			if (orders.length > 0) {
				creep.memory.target = orders[0].target;
			}
			else {
				delete creep.memory.target;
			}
		}

		if (!creep.memory.target) {
			// Movement is dictated by squad orders.
			const spawnFlags = _.filter(Game.flags, flag => flag.name === 'SpawnSquad:' + creep.memory.squadName);
			if (spawnFlags.length > 0) {
				const flag = spawnFlags[0];
				if (creep.pos.roomName === flag.pos.roomName) {
					// Refresh creep if it's getting low, so that it has high lifetime when a mission finally starts.
					if (creep.ticksToLive < CREEP_LIFE_TIME * 0.66) {
						const spawn = creep.pos.findClosestByRange(FIND_STRUCTURES, {
							filter: structure => structure.structureType === STRUCTURE_SPAWN,
						});

						if (spawn) {
							if (spawn.renewCreep(creep) !== OK) {
								creep.moveTo(spawn);
							}

							return true;
						}
					}

					// If there's nothing to do, move back to spawn flag.
					creep.moveTo(flag);
				}
			}

			return true;
		}
	}

	if (creep.memory.target) {
		const targetPosition = utilities.decodePosition(creep.memory.target);
		if (creep.pos.roomName !== targetPosition.roomName) {
			if (!this.moveToRoom(targetPosition.roomName)) {
				hivemind.log('creeps').debug(this.name, 'can\'t move from', this.pos.roomName, 'to', targetPosition.roomName);
				// @todo This is cross-room movement and should therefore only calculate a path once.
				creep.moveToRange(targetPosition, 3);
			}

			return true;
		}

		creep.moveTo(targetPosition);
	}

	if (creep.memory.order) {
		const target = Game.getObjectById(creep.memory.order.target);

		if (target) {
			if (creep.memory.body.attack) {
				const ignore = (!creep.room.controller || !creep.room.controller.owner || (!creep.room.controller.my && !hivemind.relations.isAlly(creep.room.controller.owner.username)));
				creep.moveTo(target, {
					reusePath: 5,
					ignoreDestructibleStructures: ignore,
				});
			}
			else {
				creep.goTo(target, {
					range: 1,
					maxRooms: 1,
				});
			}
		}
	}
	else {
		if (creep.memory.squadName) {
			const attackFlags = _.filter(Game.flags, flag => flag.name === 'AttackSquad:' + creep.memory.squadName);
			if (attackFlags.length > 0) {
				creep.moveTo(attackFlags[0]);

				if (creep.pos.roomName === attackFlags[0].pos.roomName) {
					creep.militaryRoomReached();
				}
				else {
					creep.memory.target = utilities.encodePosition(attackFlags[0].pos);
				}

				return;
			}
		}

		creep.moveTo(25, 25, {
			reusePath: 50,
		});
	}
};

/**
 * Makes a creep try to attack its designated target or nearby enemies.
 */
Creep.prototype.performMilitaryAttack = function () {
	const creep = this;
	if (creep.memory.order) {
		const target = Game.getObjectById(creep.memory.order.target);
		let attacked = false;

		if (target && target instanceof StructureController) {
			if (target.owner && !target.my) {
				if (creep.attackController(target) === OK) {
					attacked = true;
				}
			}
			else if (!target.my) {
				// If attack flag is directly on controller, claim it, otherwise just reserve.
				if (creep.memory.squadName && Game.flags['AttackSquad:' + creep.memory.squadName] && Game.flags['AttackSquad:' + creep.memory.squadName].pos.getRangeTo(target) === 0) {
					if (creep.claimController(target) === OK) {
						attacked = true;
					}
				}
				else {
					if (creep.reserveController(target) === OK) {
						attacked = true;
					}
				}
			}
		}
		else if (target && (!target.my && (!target.owner || !hivemind.relations.isAlly(target.owner.username)))) {
			if (creep.attack(target) === OK) {
				attacked = true;
			}
		}

		if (!attacked) {
			// See if enemies are nearby, attack one of those.
			const hostile = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
			if (hostile.length > 0) {
				for (const i in hostile) {
					// Check if enemy is harmless, and ignore it.
					if (!hostile[i].isDangerous()) continue;
					if (hostile[i].owner && hivemind.relations.isAlly(hostile[i].owner.username)) continue;

					if (creep.attack(hostile[i]) === OK) {
						attacked = true;
						break;
					}
				}
			}

			if (!attacked) {
				// See if enemy structures are nearby, attack one of those.
				let hostile = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1, {
					filter: structure => structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_STORAGE && structure.structureType !== STRUCTURE_TERMINAL,
				});
				if (creep.room.controller && creep.room.controller.owner && hivemind.relations.isAlly(creep.room.controller.owner.username)) hostile = [];
				if (hostile && hostile.length > 0) {
					// Find target with lowest HP to kill off (usually relevant while trying to break through walls).
					let minHits;
					for (const i in hostile) {
						if (hostile[i].hits && (!minHits || hostile[i].hits < hostile[minHits].hits)) {
							minHits = i;
						}
					}

					if (creep.attack(hostile[minHits]) === OK) {
						attacked = true;
					}
				}
			}
		}

		return attacked;
	}
};

/**
 * Makes a creep heal itself or nearby injured creeps.
 */
Creep.prototype.performMilitaryHeal = function () {
	const creep = this;
	let healed = false;
	if (creep.memory.order) {
		const target = Game.getObjectById(creep.memory.order.target);

		if (target && (target.my || (target.owner && hivemind.relations.isAlly(target.owner.username)))) {
			if (creep.heal(target) === OK) {
				healed = true;
			}
		}
	}

	if (!healed) {
		// See if damaged creeps are adjacent, heal those.
		const damaged = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: creep => creep.hits < creep.hitsMax,
		});
		if (_.size(damaged) > 0) {
			if (creep.heal(damaged[0]) === OK) {
				healed = true;
			}
		}
	}

	if (!healed && creep.hits < creep.hitsMax) {
		// Heal self.
		if (creep.heal(creep) === OK) {
			healed = true;
		}
	}

	if (!healed) {
		// See if damaged creeps are in range, heal those.
		const damaged = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
			filter: creep => creep.hits < creep.hitsMax,
		});
		if (_.size(damaged) > 0) {
			if (creep.rangedHeal(damaged[0]) === OK) {
				healed = true;
			}
		}
	}

	return healed;
};

Creep.prototype.initBrawlerState = function () {
	this.memory.initialized = true;

	if (this.memory.squadName) {
		const squad = Game.squads[this.memory.squadName];
		if (squad && squad.memory.pathName) {
			this.memory.pathName = squad.memory.pathName;
			this.memory.pathStep = 1;
		}
	}

	if (this.memory.squadUnitType === 'builder') {
		this.memory.fillWithEnergy = true;
	}

	if (this.memory.pathTarget) {
		if (this.room.memory.remoteHarvesting && this.room.memory.remoteHarvesting[this.memory.pathTarget] && this.room.memory.remoteHarvesting[this.memory.pathTarget].cachedPath) {
			this.setCachedPath(this.room.memory.remoteHarvesting[this.memory.pathTarget].cachedPath.path);
		}
	}
};

/**
 * Makes a creep behave like a brawler.
 */
Creep.prototype.runBrawlerLogic = function () {
	if (!this.memory.initialized) {
		this.initBrawlerState();
	}

	// Target is recalculated every turn for best results.
	this.calculateMilitaryTarget();

	this.performMilitaryMove();

	if (!this.performMilitaryAttack()) {
		this.performMilitaryHeal();
	}
};
