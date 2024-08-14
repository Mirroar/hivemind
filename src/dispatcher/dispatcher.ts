import TaskProvider from 'dispatcher/task-provider';
import utilities from 'utilities';

type ValidatorCallback<TaskType extends Task, ContextType> = (task: TaskType, context: ContextType) => boolean;

export default class Dispatcher<TaskType extends Task, ContextType> {
	protected providers: Record<string, TaskProvider<TaskType, ContextType>> = {};

	getTask(context: ContextType, validator?: ValidatorCallback<TaskType, ContextType>): TaskType {
		const options: TaskType[] = [];
		let highestPriority = -10;

		for (const provider of this.getProvidersByPriority(context)) {
			if (provider.getHighestPriority(context) < highestPriority) break;

			for (const option of provider.getTasks(context)) {
				if (option.priority < highestPriority) continue;
				if (!provider.isValid(option, context)) continue;
				if (validator && !validator(option, context)) continue;

				options.push(option);
				if (highestPriority < option.priority) highestPriority = option.priority;
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

	getProvidersByPriority(context: ContextType): Array<TaskProvider<TaskType, ContextType>> {
		return _.sortBy(this.providers, provider => -provider.getHighestPriority(context));
	}

	validateTask(task: TaskType, context: ContextType) {
		if (!this.hasProvider(task.type)) throw new Error('Invalid task type: ' + task.type);

		return this.providers[task.type].isValid(task, context);
	}

	executeTask(task: TaskType, context: ContextType) {
		if (!this.hasProvider(task.type)) throw new Error('Invalid task type: ' + task.type);

		this.providers[task.type].execute(task, context);
	}
}
