function timeCall<T>(key: string, callback: () => T): number {
	const startTime = Game.cpu.getUsed();

	callback();

	const totalTime = Game.cpu.getUsed() - startTime;

	return totalTime;
}
export {
	timeCall,
}