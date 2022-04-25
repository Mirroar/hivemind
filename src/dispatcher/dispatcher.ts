import TaskProvider from 'dispatcher/task-provider';
import utilities from 'utilities';

export default class Dispatcher<TaskType extends Task, ContextType extends Context> {
	protected providers: Record<string, TaskProvider<TaskType, ContextType>> = {};

	getTask(context: ContextType): TaskType {
		const options = [];

		for (const type in this.providers) {
			// @todo Get options by provider priority.
			const provider = this.providers[type];
			const providerOptions = provider.getTasks(context);

			for (const option of providerOptions) {
				options.push(option);
			}
		}

		return utilities.getBestOption(options);
	}

	addProvider(provider: TaskProvider<TaskType, ContextType>) {
		this.providers[provider.getType()] = provider;
	}

	hasProvider(type: string): boolean {
		return Boolean(this.providers[type]);
	}

	validateTask(task: TaskType) {
		if (!this.hasProvider(task.type)) return false;

		if (this.providers[task.type].validate) return this.providers[task.type].validate(task);

		return true;
	}
}
