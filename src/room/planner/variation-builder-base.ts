import hivemind from 'hivemind';
import PlacementManager from 'room/planner/placement-manager';
import RoomPlan from 'room/planner/room-plan';
import {handleMapArea} from 'utils/map';

declare global {
	type StepResult = 'ok' | 'failed' | 'done';
}

export default class RoomVariationBuilderBase {
	protected currentStep: number;
	protected roomPlan: RoomPlan;
	protected terrain: RoomTerrain;
	protected finished: boolean;
	protected minCutBounds: MinCutRect[];
	protected placementManager: PlacementManager;

	protected constructor(
		protected roomName: string,
		protected variation: string,

		wallMatrix: CostMatrix,
		exitMatrix: CostMatrix,
	) {
		this.currentStep = 0;
		this.finished = false;
		this.roomPlan = new RoomPlan(this.roomName);
		this.terrain = new Room.Terrain(this.roomName);
		this.minCutBounds = [];
		this.placementManager = new PlacementManager(this.roomPlan, new PathFinder.CostMatrix(), wallMatrix, exitMatrix);
	}

	getRoomPlan(): RoomPlan {
		return this.roomPlan;
	}

	buildNextStep() {
		const stepResult = this.buildStep(this.currentStep++);
		// @todo Provide a mechanism by which any step may abort the calculation.
		// @todo Handle 'failed'.

		if (stepResult === 'done') {
			this.finished = true;
			hivemind.log('rooms', this.roomName).info('Finished building room plan variation', this.variation);
		}
	}

	buildStep(step: number): StepResult {
		return 'done';
	}

	placeBayStructures(bayPosition: RoomPosition, options: {spawn?: boolean; source?: boolean; id?: number} = {}) {
		if (this.roomPlan.canPlaceMore('spawn') && options.spawn) {
			handleMapArea(bayPosition.x, bayPosition.y, (x, y) => {
				if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return true;
				if (!this.placementManager.isBuildableTile(x, y)) return true;
				if (x === bayPosition.x && y === bayPosition.y) return true;

				// Only place spawn where a road tile is adjacent, so creeps can
				// actually exit when a harvester is on its spot.
				let spawnPlaced = false;
				handleMapArea(x, y, (x2, y2) => {
					if (x2 == bayPosition.x && y2 == bayPosition.y) return true;
					if (!this.roomPlan.hasPosition('road', new RoomPosition(x2, y2, this.roomName))) return true;

					this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'spawn.' + this.roomPlan.getPositions('spawn').length);
					this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'spawn');
					spawnPlaced = true;
					return false;
				});

				if (spawnPlaced) return false;

				return true;
			});
		}

		let linkPlaced = !this.roomPlan.canPlaceMore('link') || !options.source;
		handleMapArea(bayPosition.x, bayPosition.y, (x, y) => {
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;
			if (!this.placementManager.isBuildableTile(x, y)) return;
			if (x === bayPosition.x && y === bayPosition.y) return;

			if (linkPlaced) {
				this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'extension');
				if (options.source) {
					this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'extension.harvester');
				}
				else {
					if (typeof options.id !== 'undefined') {
						this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'extension.bay.' + options.id);
					}
					this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'extension.bay');
				}
			}
			else {
				this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'link');
				if (options.source) {
					this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'link.source');
				}
				linkPlaced = true;
			}
		});
	}

	/**
	 * Places a link near a given road.
	 *
	 * @param {RoomPosition[]} sourceRoads
	 *   Positions that make up the road.
	 * @param {string} linkType
	 *   Type identifier for this link, like `source` or `controller`.
	 */
	placeLink(sourceRoads: RoomPosition[], linkType: string) {
		const targetPos = this.findLinkPosition(sourceRoads);

		if (!targetPos) return;

		if (linkType) {
			this.placementManager.planLocation(targetPos, 'link.' + linkType, null);
		}

		this.placementManager.planLocation(targetPos, 'link');
	};

	/**
	 * Finds a spot for a link near a given road.
	 *
	 * @param {RoomPosition[]} sourceRoads
	 *   Positions that make up the road.
	 *
	 * @return {RoomPosition}
	 *   A Position at which a container can be placed.
	 */
	findLinkPosition(sourceRoads: RoomPosition[]): RoomPosition {
		let targetPosition: RoomPosition;
		for (const pos of _.slice(sourceRoads, 0, 3)) {
			handleMapArea(pos.x, pos.y, (x, y) => {
				if (this.placementManager.isBuildableTile(x, y, true)) {
					targetPosition = new RoomPosition(x, y, pos.roomName);
					return false;
				}

				return true;
			});
		}

		return targetPosition;

	};

	/**
	 * Places a container near a given road.
	 *
	 * @param {RoomPosition[]} sourceRoads
	 *   Positions that make up the road.
	 * @param {string} containerType
	 *   Type identifier for this container, like `source` or `controller`.
	 */
	placeContainer(sourceRoads: RoomPosition[], containerType: string) {
		const targetPos = this.findContainerPosition(sourceRoads);

		if (!targetPos) return;

		if (containerType) {
			this.placementManager.planLocation(targetPos, 'container.' + containerType, null);
		}

		this.placementManager.planLocation(targetPos, 'container', 1);
	};

	/**
	 * Finds a spot for a container near or on a given road.
	 *
	 * @param {RoomPosition[]} sourceRoads
	 *   Positions that make up the road.
	 *
	 * @return {RoomPosition}
	 *   A Position at which a container can be placed.
	 */
	findContainerPosition(sourceRoads: RoomPosition[]): RoomPosition {
		if (sourceRoads[0] && this.placementManager.isBuildableTile(sourceRoads[0].x, sourceRoads[0].y, true)) {
			return sourceRoads[0];
		}

		if (sourceRoads[1] && this.placementManager.isBuildableTile(sourceRoads[1].x, sourceRoads[1].y, true)) {
			return sourceRoads[1];
		}

		return this.findLinkPosition(sourceRoads);
	};

	/**
	 * Adds a position to be protected by minCut.
	 */
	protectPosition(pos: RoomPosition, distance?: number) {
		if (typeof distance === 'undefined') distance = hivemind.settings.get('minCutRampartDistance');
		const x1 = Math.max(2, pos.x - distance);
		const x2 = Math.min(47, pos.x + distance);
		const y1 = Math.max(2, pos.y - distance);
		const y2 = Math.min(47, pos.y + distance);
		this.minCutBounds.push({x1, x2, y1, y2});
	};

}
