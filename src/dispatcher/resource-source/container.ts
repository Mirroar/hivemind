import StructureSource from 'dispatcher/resource-source/structure';
import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface ContainerSourceTask extends StructureSourceTask {
		type: 'container';
		target: Id<StructureContainer>;
	}
}

export default class ContainerSource extends StructureSource<ContainerSourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'container' {
		return 'container';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceSourceContext) {
		const options: ContainerSourceTask[] = [];

		// @todo

		return options;
	}
}
