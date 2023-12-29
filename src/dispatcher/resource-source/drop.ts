import TaskProvider from '../task-provider';
import { ENEMY_STRENGTH_NONE } from '../../room-defense';
import { getDangerMatrix } from '../../utils/cost-matrix';

interface DropSourceTask extends ResourceSourceTask {
  type: 'drop';
  target: Id<Resource>;
}

export default class DropSource implements TaskProvider<DropSourceTask, ResourceSourceTask> {
  constructor(readonly room: Room) {
  }

  getType(): 'drop' {
    return 'drop';
  }

  getHighestPriority() {
    return 7;
  }

  getTasks(context: ResourceSourceContext) {
    const options: DropSourceTask[] = [];

    this.addObjectResourceOptions(options, FIND_DROPPED_RESOURCES, context);

    return options;
  }

  /**
   * Adds options for picking up resources from certain objects to priority list.
   *
   * @param {Array} options
   *   A list of potential resource sources.
   * @param {String} findConstant
   *   The type of find operation to run, e.g. FIND_DROPPED_RESOURCES.
   */
  addObjectResourceOptions(options: DropSourceTask[], findConstant: FIND_DROPPED_RESOURCES, context: ResourceSourceContext) {
    const creep = context.creep;
    const resourceType = context.resourceType;

    // Look for resources on the ground.
    const targets = creep.room.find(findConstant, {
      filter: target => {
        if (!this.isSafePosition(creep as Creep, target.pos)) return false;

        if (resourceType && resourceType != target.resourceType) return false;

        if (target.amount > 10) {
          const result = PathFinder.search(creep.pos, target.pos);
          if (!result.incomplete) return true;
        }

        return false;
      }
    });

    for (const target of targets) {
      // const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
      const resourceType = target.resourceType;
      // if (resourceType === RESOURCE_ENERGY) continue;

      const option = {
        priority: 5,
        weight: target.amount / 30, // @todo Also factor in distance.
        type: this.getType(),
        target: target.id,
        resourceType
      };

      if (resourceType === RESOURCE_POWER) {
        option.priority++;
      }
      if (resourceType === RESOURCE_ENERGY) {
        option.priority += 2;
      }

      if (target.amount < creep.store.getCapacity() * 2) {
        option.priority -= creep.room.getCreepsWithOrder(this.getType(), target.id).length * 2;
      }

      options.push(option);
    }
  }

  isSafePosition(creep: Creep, pos: RoomPosition): boolean {
    if (!creep.room.isMine()) return true;
    if (creep.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return true;

    const matrix = getDangerMatrix(creep.room.name);
    if (matrix.get(pos.x, pos.y) > 0) return false;

    return true;
  }

  isValid(task: DropSourceTask, context: ResourceSourceContext) {
    const target = Game.getObjectById(task.target);
    if (!target) return false;
    if (target.amount < context.creep.store.getFreeCapacity() / 4) return false;

    return true;
  }

  execute(task: DropSourceTask, context: ResourceSourceContext) {
    const creep = context.creep;
    const target = Game.getObjectById(task.target);
    creep.whenInRange(1, target, () => {
      creep.pickup(target);
      delete creep.memory.order;
    });
  }
}
