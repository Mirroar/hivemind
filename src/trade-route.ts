declare global {
	interface Memory {
		tradeRoutes: Record<string, TradeRouteMemory>;
	}

	namespace NodeJS {
		interface Global {
			TradeRoute: typeof TradeRoute;
		}
	}
}

type TradeRouteMemory = {
	origin?: string;
	target?: string;
	active?: boolean;
	roomPath?: string[];
	resourceType?: ResourceConstant;
	travelLength?: number;
	travelLengthCalculated?: number;
};

export default class TradeRoute {
	memory: TradeRouteMemory;

	constructor(name: string) {
		if (!Memory.tradeRoutes) Memory.tradeRoutes = {};
		if (!Memory.tradeRoutes[name]) Memory.tradeRoutes[name] = {};

		this.memory = Memory.tradeRoutes[name];
	}

	setOrigin(roomName: string) {
		this.memory.origin = roomName;
	}

	getOrigin() {
		return this.memory.origin;
	}

	setTarget(roomName: string) {
		this.memory.target = roomName;
	}

	getTarget() {
		return this.memory.target;
	}

	setActive(active: boolean) {
		this.memory.active = active;
	}

	isActive() {
		return this.memory.active;
	}

	setPath(path: string[]) {
		this.memory.roomPath = path;
	}

	getPath() {
		return this.memory.roomPath;
	}

	getReversePath() {
		if (!this.memory.roomPath) return null;
		return this.memory.roomPath.slice(0, -1).reverse().concat([this.getOrigin()]);
	}

	setResourceType(resourceType: ResourceConstant) {
		this.memory.resourceType = resourceType;
	}

	getResourceType() {
		return this.memory.resourceType;
	}

	setTravelLength(length: number) {
		this.memory.travelLength = length;
		this.memory.travelLengthCalculated = Game.time;
	}

	getTravelLength() {
		return this.memory.travelLength;
	}

	hasTravelLength() {
		return this.memory.travelLength && (Game.time - this.memory.travelLengthCalculated < 10_000);
	}
}
global.TradeRoute = TradeRoute;
