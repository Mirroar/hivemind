import TaskProvider from 'dispatcher/task-provider';
import { getDangerMatrix } from 'utils/cost-matrix';

interface ScoreContainerSourceTask extends ResourceSourceTask {
    type: 'score-container';
    target: Id<ScoreContainer>;
}

export default class ScoreContainerSource extends TaskProvider<ScoreContainerSourceTask, ResourceSourceContext> {
    constructor(readonly room: Room) {
        super();
    }

    getType(): 'score-container' {
        return 'score-container';
    }

    getHighestPriority() {
        return 3;
    }

    getTasks(context: ResourceSourceContext) {
        if (context.resourceType && context.resourceType !== RESOURCE_SCORE) return [];

        const options: ScoreContainerSourceTask[] = [];
        for (const scoreContainer of this.room.find(FIND_SCORE_CONTAINERS)) {
            const option: ScoreContainerSourceTask = {
                priority: 3,
                weight: scoreContainer.store[RESOURCE_SCORE] / 100, // @todo Also factor in distance.
                type: this.getType(),
                target: scoreContainer.id,
                resourceType: RESOURCE_SCORE,
            };

            options.push(option);
        }

        return options;
    }

    isValid(task: ScoreContainerSourceTask, context: ResourceSourceContext): boolean {
		if (!task.resourceType) return false;
		const scoreContainer = Game.getObjectById(task.target);
		if (!scoreContainer) return false;
		if (scoreContainer.store.getUsedCapacity(task.resourceType) === 0) return false;
		if (context.creep.store.getFreeCapacity(task.resourceType) === 0) return false;
		if (!this.isSafePosition(context.creep, scoreContainer.pos)) return false;

		return true;
    }

    execute(task: ScoreContainerSourceTask, context: ResourceSourceContext): void {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);

		creep.whenInRange(1, target, () => {
			const resourceType = task.resourceType;

			let result: ScreepsReturnCode;
			if (task.amount) {
				result = creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), creep.memory.order.amount, creep.store.getFreeCapacity()));
			}
			else {
				result = creep.withdraw(target, resourceType);
			}

			if (result === OK) delete creep.memory.order;
		});
    }
    
	isSafePosition(creep: Creep, pos: RoomPosition): boolean {
		if (!creep.room.isMine()) return true;
		if (creep.room.defense.getEnemyStrength() === 0) return true;

		const matrix = getDangerMatrix(creep.room.name);
		if (matrix.get(pos.x, pos.y) > 0) return false;

		return true;
	}
}