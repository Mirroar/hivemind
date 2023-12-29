import { ENEMY_STRENGTH_NONE } from '../../room-defense';
import { getDangerMatrix } from '../../utils/cost-matrix';
import StructureSource from './structure';
import { getResourcesIn } from '../../utils/store';

interface GraveSourceTask extends StructureSourceTask {
  type: 'grave';
  target: Id<Ruin | Tombstone>;
}

export default class GraveSource extends StructureSource<GraveSourceTask> {
  constructor(readonly room: Room) {
    super(room);
  }

  getType(): 'grave' {
    return 'grave';
  }

  getHighestPriority() {
    return 4;
  }

  getTasks(context: ResourceSourceContext) {
    const options: GraveSourceTask[] = [];

    this.addObjectResourceOptions(options, FIND_RUINS, context);
    this.addObjectResourceOptions(options, FIND_TOMBSTONES, context);

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
  addObjectResourceOptions(options: GraveSourceTask[], findConstant: FIND_RUINS | FIND_TOMBSTONES, context: ResourceSourceContext) {
    const creep = context.creep;
    const resourceType = context.resourceType;

    // Look for resources on the ground.
    const targets = creep.room.find(findConstant, {
      filter: target => {
        if (!this.isSafePosition(creep as Creep, target.pos)) return false;

        if (target.store.getUsedCapacity() < 10) return false;
        if (resourceType && target.store.getUsedCapacity(resourceType) < 10) return false;

        const result = PathFinder.search(creep.pos, target.pos);
        if (!result.incomplete) return true;

        return false;
      }
    });

    for (const target of targets) {
      for (const resourceType of getResourcesIn(target.store)) {

        const option = {
          priority: 4,
          weight: target.store.getUsedCapacity(resourceType) / 30, // @todo Also factor in distance.
          type: this.getType(),
          target: target.id,
          resourceType
        };

        if (target.ticksToDecay < 100) option.priority++;

        if (resourceType === RESOURCE_POWER) {
          option.priority++;
        }
        if (resourceType === RESOURCE_ENERGY) {
          option.priority += 2;
        }

        if (target.store.getUsedCapacity(resourceType) < creep.store.getCapacity() * 2) {
          option.priority -= creep.room.getCreepsWithOrder(this.getType(), target.id).length * 2;
        }

        options.push(option);
      }
    }
  }

  isSafePosition(creep: Creep, pos: RoomPosition): boolean {
    if (!creep.room.isMine()) return true;
    if (creep.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return true;

    const matrix = getDangerMatrix(creep.room.name);
    if (matrix.get(pos.x, pos.y) > 0) return false;

    return true;
  }

  isValid(task: GraveSourceTask, context: ResourceSourceContext) {
    const target = Game.getObjectById(task.target);
    if (!target) return false;
    if (target.store.getUsedCapacity(task.resourceType) === 0) return false;
    if (context.creep.store.getFreeCapacity(task.resourceType) === 0) return false;
    if (!this.isSafePosition(context.creep, target.pos)) return false;

    return true;
  }

  execute(task: GraveSourceTask, context: ResourceSourceContext) {
    const creep = context.creep;
    const target = Game.getObjectById(task.target);
    creep.whenInRange(1, target, () => {
      const resourceType = task.resourceType;

      let result;
      if (task.amount)
        result = creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), task.amount, creep.store.getFreeCapacity()));
      else
        result = creep.withdraw(target, resourceType);

      if (result != OK) delete creep.memory.order;
    });
  }
}
