import TaskProvider from 'dispatcher/task-provider';
import { ENEMY_STRENGTH_NONE } from 'room-defense';
import { getDangerMatrix } from 'utils/cost-matrix';

interface DropSourceTask extends ResourceSourceTask {
	type: 'drop';
	target: Id<Resource>;
}

export default class DropSource extends TaskProvider<DropSourceTask, ResourceSourceContext> {
	constructor(readonly room: Room) {
		super();
	}

	getType(): 'drop' {
		return 'drop';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceSourceContext) {
		const options: DropSourceTask[] = [];

		this.addDroppedResourceOptions(options, context);

		return options;
	}

	private addDroppedResourceOptions(options: DropSourceTask[], context: ResourceSourceContext) {
		const creep = context.creep;

		// Look for dropped resources.
		const resources = this.room.find(FIND_DROPPED_RESOURCES, {
			filter: resource => {
				if (resource.amount < 10) return false;

				const result = PathFinder.search(creep.pos, resource.pos);
				if (result.incomplete) return false;

				return true;
			},
		});

		for (const resource of resources) {
			if (context.resourceType && context.resourceType !== resource.resourceType) return;

			const option: DropSourceTask = {
				priority: 4,
				weight: resource.amount / (resource.resourceType === RESOURCE_ENERGY ? 100 : 30), // @todo Also factor in distance.
				type: this.getType(),
				target: resource.id,
				resourceType: resource.resourceType,
			};

			if (resource.resourceType === RESOURCE_POWER) {
				option.priority++;
			}
			else if (resource.resourceType === RESOURCE_ENERGY) {
				// Get storage location, since that is a low priority source for transporters.
				const storagePosition = creep.room.getStorageLocation();

				if (storagePosition && resource.pos.x === storagePosition.x && resource.pos.y === storagePosition.y) {
					option.priority = creep.memory.role === 'transporter' ? ((creep.room.storage || creep.room.terminal) ? 1 : 0) : 4;
				}
				else {
					if (resource.amount < 100) option.priority--;
					if (resource.amount < 200) option.priority--;
	
					// If spawn / extensions need filling, transporters should not pick up
					// energy from random targets as readily, instead prioritize storage.
					if (creep.room.energyAvailable < creep.room.energyCapacityAvailable && creep.room.getCurrentResourceAmount(RESOURCE_ENERGY) > 5000 && creep.memory.role === 'transporter') option.priority -= 2;

					if (creep.room.storage && creep.room.getFreeStorage() < resource.amount && creep.room.getEffectiveAvailableEnergy() > 20_000) {
						// If storage is super full, try leaving stuff on the ground.
						option.priority -= 2;
					}
				}
			}

			if ((creep.room.storage || creep.room.terminal) && creep.room.getFreeStorage() < resource.amount) {
				// If storage is super full, try leaving stuff on the ground.
				continue;
			}

			if (resource.amount < creep.store.getCapacity() * 2) {
				// We only need to limit the number of creeps picking up resources if the amount is small.
				option.priority -= this.room.getCreepsWithOrder('drop', resource.id).length * 2;
			}

			options.push(option);
		}
	}

	isValid(task: DropSourceTask, context: ResourceSourceContext): boolean {
		const resource = Game.getObjectById(task.target);
		if (!resource) return false;
		if (resource.amount === 0) return false;
		if (context.creep.store.getFreeCapacity(resource.resourceType) === 0) return false;
		if (!this.isSafePosition(context.creep, resource.pos)) return false;

		const terminal = this.room.terminal;
		const terminalNeedsSpaceForEnergy = terminal && (terminal.store.getFreeCapacity() + terminal.store.getUsedCapacity(RESOURCE_ENERGY)) < 5000;
		if (task.resourceType !== RESOURCE_ENERGY && terminalNeedsSpaceForEnergy) return false;

		return true;
	}

	isSafePosition(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
		if (!creep.room.isMine()) return true;
		if (creep.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return true;

		const matrix = getDangerMatrix(creep.room.name);
		if (matrix.get(pos.x, pos.y) > 0) return false;

		return true;
	}

	execute(task: DropSourceTask, context: ResourceSourceContext): void {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);

		creep.whenInRange(1, target, () => {
			creep.pickup(target);
		});
	}
}