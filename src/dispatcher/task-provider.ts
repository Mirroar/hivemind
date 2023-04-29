declare global {
	interface Task {
		type: string;
		priority: number;
		weight: number;
	}
}

export default interface TaskProvider<TaskType extends Task, ContextType> {
	getType: () => string;
	getHighestPriority: (context?: ContextType) => number;
	getTasks: (context: ContextType) => TaskType[];
	isValid?: (task: TaskType, context: ContextType) => boolean;
	execute?: (task: TaskType, context: ContextType) => void;
}
