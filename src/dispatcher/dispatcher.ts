import TaskProvider from 'dispatcher/task-provider';
import utilities from 'utilities';

export default class Dispatcher<TaskType extends Task, ContextType> {
	protected providers: Record<string, TaskProvider<TaskType, ContextType>> = {};

	getTask(context: ContextType): TaskType {
		const options: TaskType[] = [];

		_.each(this.providers, provider => {
			// @todo Get options by provider priority.
			const providerOptions = provider.getTasks(context);

			for (const option of providerOptions) {
				options.push(option);
			}
		});

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
