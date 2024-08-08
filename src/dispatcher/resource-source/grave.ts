import TaskProvider from "dispatcher/task-provider";
import { ENEMY_STRENGTH_NONE } from "room-defense";
import { getDangerMatrix } from "utils/cost-matrix";
import { getResourcesIn } from "utils/store";

interface GraveSourceTask extends ResourceSourceTask {
	type: 'grave';
	target: Id<Tombstone | Ruin>;
}

export default class GraveSource extends TaskProvider<GraveSourceTask, ResourceSourceContext> {
	constructor(readonly room: Room) {
		super();
	}

	getType(): 'grave' {
		return 'grave';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceSourceContext) {
		const options: GraveSourceTask[] = [];

		this.addGraveResourceOptions(options, context);

		return options;
	}

	private addGraveResourceOptions(options: GraveSourceTask[], context: ResourceSourceContext) {
		const creep = context.creep;

		// Look for tombstones and ruins with resources.
		const targets = (this.room.find(FIND_TOMBSTONES) as Array<Tombstone | Ruin>)
			.concat(this.room.find(FIND_RUINS))
			.filter(target => {
				return target.store.getUsedCapacity() > 10;
			});

		for (const target of targets) {
			// @todo It might be more effective to only create one task per tombstone / ruin and pick up all resources at once.
			for (const resourceType of getResourcesIn(target.store)) {
				if (context.resourceType && resourceType !== context.resourceType) continue;

				const amount = target.store.getUsedCapacity(resourceType);
				const option: GraveSourceTask = {
					priority: 4,
					weight: amount / (resourceType === RESOURCE_ENERGY ? 100 : 30), // @todo Also factor in distance.
					type: this.getType(),
					target: target.id,
					resourceType: resourceType,
				};

				if (resourceType === RESOURCE_POWER) {
					option.priority++;
				}
				else if (resourceType === RESOURCE_ENERGY) {
					if (amount < 100) option.priority--;
					if (amount < 200) option.priority--;
	
					// If spawn / extensions need filling, transporters should not pick up
					// energy from random targets as readily, instead prioritize storage.
					if (creep.room.energyAvailable < creep.room.energyCapacityAvailable && creep.room.getCurrentResourceAmount(RESOURCE_ENERGY) > 5000 && creep.memory.role === 'transporter') option.priority -= 2;

					if (creep.room.storage && creep.room.getFreeStorage() < amount && creep.room.getEffectiveAvailableEnergy() > 20_000) {
						// If storage is super full, try leaving stuff on the ground.
						option.priority -= 2;
					}
				}

				if (creep.room.getFreeStorage() < target.store.getUsedCapacity(resourceType)) {
					// If storage is super full, try leaving stuff on the ground.
					continue;
				}

				if (target.store.getUsedCapacity() < creep.store.getCapacity() * 2) {
					// We only need to limit the number of creeps picking up resources if the amount is small.
					option.priority -= this.room.getCreepsWithOrder('grave', target.id).length * 2;
				}

				options.push(option);
			}
		}
	}

	isValid(task: GraveSourceTask, context: ResourceSourceContext): boolean {
		const tombstone = Game.getObjectById(task.target);
		if (!tombstone) return false;
		if (tombstone.store.getUsedCapacity(task.resourceType) === 0) return false;
		if (context.creep.store.getFreeCapacity(task.resourceType) === 0) return false;
		if (!this.isSafePosition(context.creep, tombstone.pos)) return false;

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

	execute(task: GraveSourceTask, context: ResourceSourceContext): void {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);

		creep.whenInRange(1, target, () => {
			creep.withdraw(target, task.resourceType);
		});
	}
}