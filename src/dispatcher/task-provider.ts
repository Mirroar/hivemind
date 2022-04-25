declare global {
	interface Task {
		type: string;
		priority: number;
		weight: number;
	}

	interface Context {}
}

export default interface TaskProvider<TaskType extends Task, ContextType extends Context> {
	getType: () => string;
	getHighestPriority: () => number;
	getTasks: (context?: ContextType) => TaskType[];
	validate?: (task: TaskType) => boolean;
}
