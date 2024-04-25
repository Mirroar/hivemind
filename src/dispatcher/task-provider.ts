declare global {
	interface Task {
		type: string;
		priority: number;
		weight: number;
	}
}

export default abstract class TaskProvider<TaskType extends Task, ContextType> {
	taskTimeouts: Record<string, number> = {};

	abstract getType(): string;
	abstract getHighestPriority(context?: ContextType): number;
	abstract getTasks(context: ContextType): TaskType[];
	abstract isValid(task: TaskType, context: ContextType): boolean;
	abstract execute(task: TaskType, context: ContextType): void;

	cacheEmptyTaskListFor(cacheKey: string, timeout: number, callback: () => TaskType[]): TaskType[] {
		if (this.shouldNotCheckForAWhile(cacheKey)) return [];

		const options = callback();
		this.stopCheckingIfNothingToDo(cacheKey, timeout, options);

		return options;
	}

	shouldNotCheckForAWhile(cacheKey: string): boolean {
		if ((this.taskTimeouts[cacheKey] || -1000) > Game.time) return true;

		return false;
	}

	stopCheckingIfNothingToDo(cacheKey: string, timeout: number, options: SpawnOption[]) {
		if (options.length > 0) return;

		this.taskTimeouts[cacheKey] = Game.time + timeout;
	}
}
