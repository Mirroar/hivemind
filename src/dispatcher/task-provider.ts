declare global {
	interface Task {
		type: string;
		priority: number;
		weight: number;
	}
}

export default interface TaskProvider<TaskType extends Task, ContextType> {
	getType: () => string;
	getHighestPriority: () => number;
	getTasks: (context?: ContextType) => TaskType[];
	validate?: (task: TaskType) => boolean;
}
