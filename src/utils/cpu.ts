let callTimes = {};
let firstTick = Game.time;

function timeCall<T>(key: string, callback: () => T): number {
	const startTime = Game.cpu.getUsed();
	callback();
	const totalTime = Game.cpu.getUsed() - startTime;
	recordCallStats(key, totalTime);

	return totalTime;
}

function recordCallStats(key: string, totalTime: number) {
	if (firstTick < Game.time - 1000) {
		firstTick = Game.time;
		callTimes = {};
	}

	if (!callTimes[key]) callTimes[key] = [];

	callTimes[key].push(totalTime);
}

function getCallStats(prefix?: string) {
	const stats = {};
	for (const key in callTimes) {
		if (prefix && !key.startsWith(prefix)) continue;

		stats[key] = generateCallStats(key);
	}

	return stats;
}

function generateCallStats(key: string) {
	let maximum;
	let sum = 0;

	for (const record of callTimes[key]) {
		sum += record;

		if (!maximum || maximum < record) maximum = record;
	}

	return {
		average: sum / callTimes[key].length,
		maximum,
		count: callTimes[key].length,
	};
}

export {
	timeCall,
	getCallStats,
};
