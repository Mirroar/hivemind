import cache from 'utils/cache';

declare global {
	interface ReportClasses {
		ResourcesReport: ResourcesReport;
	}
}

interface ResourceEntry {
	resourceType: ResourceConstant;
	label?: string;
	color: string;
	height?: number;
	scale?: number;
	hidden?: boolean;
}

interface ResourceRow {
	label: string;
	resources: ResourceEntry[];
}

const resourcesToReport: ResourceRow[] = [
	{
		label: '📦',
		resources: [
			{color: '#32167E', resourceType: RESOURCE_KEANIUM_BAR, height: 2, scale: 2 / 5, label: 'K🪨'},
			{color: '#9973F7', resourceType: RESOURCE_KEANIUM, height: 2, scale: 2},
			{color: '#9973F7', resourceType: RESOURCE_KEANIUM_HYDRIDE},
			{color: '#9973F7', resourceType: RESOURCE_KEANIUM_ACID},
			{color: '#9973F7', resourceType: RESOURCE_CATALYZED_KEANIUM_ACID},
		],
	},
	{
		label: '🏹',
		resources: [
			{color: '#32167E', resourceType: RESOURCE_KEANIUM_BAR, hidden: true, scale: 2 / 5, label: 'K🪨'},
			{color: '#9973F7', resourceType: RESOURCE_KEANIUM, hidden: true, scale: 2},
			{color: '#9973F7', resourceType: RESOURCE_KEANIUM_OXIDE},
			{color: '#9973F7', resourceType: RESOURCE_KEANIUM_ALKALIDE},
			{color: '#9973F7', resourceType: RESOURCE_CATALYZED_KEANIUM_ALKALIDE},
		],
	},
	{
		label: '🏗️',
		resources: [
			{color: '#346046', resourceType: RESOURCE_LEMERGIUM_BAR, height: 2, scale: 2 / 5, label: 'L🪨'},
			{color: '#70F0A9', resourceType: RESOURCE_LEMERGIUM, height: 2, scale: 2},
			{color: '#70F0A9', resourceType: RESOURCE_LEMERGIUM_HYDRIDE},
			{color: '#70F0A9', resourceType: RESOURCE_LEMERGIUM_ACID},
			{color: '#70F0A9', resourceType: RESOURCE_CATALYZED_LEMERGIUM_ACID},
		],
	},
	{
		label: '💊',
		resources: [
			{color: '#346046', resourceType: RESOURCE_LEMERGIUM_BAR, hidden: true, scale: 2 / 5, label: 'L🪨'},
			{color: '#70F0A9', resourceType: RESOURCE_LEMERGIUM, hidden: true, scale: 2},
			{color: '#70F0A9', resourceType: RESOURCE_LEMERGIUM_OXIDE},
			{color: '#70F0A9', resourceType: RESOURCE_LEMERGIUM_ALKALIDE},
			{color: '#70F0A9', resourceType: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE},
		],
	},
	{
		label: '⚔️',
		resources: [
			{color: '#285F7E', resourceType: RESOURCE_UTRIUM_BAR, height: 2, scale: 2 / 5, label: 'U🪨'},
			{color: '#78D4F5', resourceType: RESOURCE_UTRIUM, height: 2, scale: 2},
			{color: '#78D4F5', resourceType: RESOURCE_UTRIUM_HYDRIDE},
			{color: '#78D4F5', resourceType: RESOURCE_UTRIUM_ACID},
			{color: '#78D4F5', resourceType: RESOURCE_CATALYZED_UTRIUM_ACID},
		],
	},
	{
		label: '⛏',
		resources: [
			{color: '#285F7E', resourceType: RESOURCE_UTRIUM_BAR, hidden: true, scale: 2 / 5, label: 'U🪨'},
			{color: '#78D4F5', resourceType: RESOURCE_UTRIUM, hidden: true, scale: 2},
			{color: '#78D4F5', resourceType: RESOURCE_UTRIUM_OXIDE},
			{color: '#78D4F5', resourceType: RESOURCE_UTRIUM_ALKALIDE},
			{color: '#78D4F5', resourceType: RESOURCE_CATALYZED_UTRIUM_ALKALIDE},
		],
	},
	{
		label: '🧨',
		resources: [
			{color: '#5A4D32', resourceType: RESOURCE_ZYNTHIUM_BAR, height: 2, scale: 2 / 5, label: 'Z🪨'},
			{color: '#F6D592', resourceType: RESOURCE_ZYNTHIUM, height: 2, scale: 2},
			{color: '#F6D592', resourceType: RESOURCE_ZYNTHIUM_HYDRIDE},
			{color: '#F6D592', resourceType: RESOURCE_ZYNTHIUM_ACID},
			{color: '#F6D592', resourceType: RESOURCE_CATALYZED_ZYNTHIUM_ACID},
		],
	},
	{
		label: '🚲',
		resources: [
			{color: '#5A4D32', resourceType: RESOURCE_ZYNTHIUM_BAR, hidden: true, scale: 2 / 5, label: 'Z🪨'},
			{color: '#F6D592', resourceType: RESOURCE_ZYNTHIUM, hidden: true, scale: 2},
			{color: '#F6D592', resourceType: RESOURCE_ZYNTHIUM_OXIDE},
			{color: '#F6D592', resourceType: RESOURCE_ZYNTHIUM_ALKALIDE},
			{color: '#F6D592', resourceType: RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE},
		],
	},
	{
		label: '🙏',
		resources: [
			{color: '#B4B4B4', resourceType: RESOURCE_GHODIUM_MELT, height: 2, scale: 2 / 5, label: 'G🪨'},
			{color: '#FFFFFF', resourceType: RESOURCE_GHODIUM, height: 2, scale: 2},
			{color: '#FFFFFF', resourceType: RESOURCE_GHODIUM_HYDRIDE},
			{color: '#FFFFFF', resourceType: RESOURCE_GHODIUM_ACID},
			{color: '#FFFFFF', resourceType: RESOURCE_CATALYZED_GHODIUM_ACID},
			{color: '#B4B4B4', resourceType: 'ZK'},
		],
	},
	{
		label: '🛡',
		resources: [
			{color: '#B4B4B4', resourceType: RESOURCE_GHODIUM_MELT, hidden: true, scale: 2 / 5, label: 'G🪨'},
			{color: '#FFFFFF', resourceType: RESOURCE_GHODIUM, hidden: true, scale: 2},
			{color: '#FFFFFF', resourceType: RESOURCE_GHODIUM_OXIDE},
			{color: '#FFFFFF', resourceType: RESOURCE_GHODIUM_ALKALIDE},
			{color: '#FFFFFF', resourceType: RESOURCE_CATALYZED_GHODIUM_ALKALIDE},
			{color: '#B4B4B4', resourceType: 'UL'},
		],
	},
	{
		label: 'O',
		resources: [
			{color: '#B4B4B4', resourceType: RESOURCE_HYDROXIDE, height: 2, scale: 2},
			{color: '#4C4C4C', resourceType: RESOURCE_OXIDANT, scale: 1 / 5, label: 'O🪨'},
			{color: '#B4B4B4', resourceType: RESOURCE_OXYGEN},
		],
	},
	{
		label: 'H',
		resources: [
			{color: '#B4B4B4', resourceType: RESOURCE_HYDROXIDE, hidden: true, scale: 2},
			{color: '#4C4C4C', resourceType: RESOURCE_REDUCTANT, scale: 1 / 5, label: 'H🪨'},
			{color: '#B4B4B4', resourceType: RESOURCE_HYDROGEN},
		],
	},
	{
		label: 'X',
		resources: [
			{color: '#532523', resourceType: RESOURCE_PURIFIER, scale: 1 / 5, label: 'X🪨'},
			{color: '#EE837E', resourceType: RESOURCE_CATALYST},
		],
	},
];

export default class ResourcesReport {
	visualize() {
		const visual = new RoomVisual();

		visual.text('Resources', 1, 48, {
			align: 'left',
		});

		const minX = 3;
		const maxX = 30;
		const maxResources = this.getHighestResourceAmountOfRow();
		if (maxResources === 0) return;
		const scale = (maxX - minX) / maxResources;

		for (const [i, resourceRow] of resourcesToReport.entries()) {
			const y = i + 30;

			visual.text(resourceRow.label, 1, y + 0.3, {align: 'left'});

			let currentX = minX;
			for (const resourceInfo of resourceRow.resources) {
				const width = this.getResourceAmount(resourceInfo.resourceType) / (resourceInfo.scale ?? 1) * scale;
				const height = resourceInfo.height ?? 1;

				if (!resourceInfo.hidden) {
					visual.rect(currentX - 0.5, y - 0.5, width, height, {
						fill: resourceInfo.color,
						opacity: 0.8,
						stroke: '#ffffff',
						strokeWidth: 0.1,
					});

					const label = resourceInfo.label ?? resourceInfo.resourceType;
					if (width > label.length / 2) {
						visual.text(label, currentX - 0.5 + width / 2, y - 0.2 + height / 2);
					}
				}

				currentX += width;
			}
		}
	}

	getHighestResourceAmountOfRow(): number {
		return _.max(_.map(resourcesToReport, resourceRow => _.sum(resourceRow.resources, resourceInfo => this.getResourceAmount(resourceInfo.resourceType) / (resourceInfo.scale ?? 1))));
	}

	getResourceAmount(resourceType: ResourceConstant) {
		return cache.inObject(this, 'resourceAmount:' + resourceType, 10, () => {
			let total = 0;

			for (const room of Game.myRooms) {
				total += room.getCurrentResourceAmount(resourceType);
			}

			return total;
		});
	}

	help() {
		return 'Get a visual representation of the amount of boosts and their components for the whole shard.';
	}
}
