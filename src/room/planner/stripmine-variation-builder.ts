import hivemind from 'hivemind';
import PlacementManager from 'room/planner/placement-manager';
import RoomPlan from 'room/planner/room-plan';
import RoomVariationBuilder from 'room/planner/variation-builder';

export default class StripmineRoomVariationBuilder extends RoomVariationBuilder {
	exitCenters: ExitCoords;
	roomCenter: RoomPosition;
	roomCenterEntrances: RoomPosition[];

	safetyMatrix: CostMatrix;

	constructor(roomName: string, variation: string, protected variationInfo: VariationInfo, wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
		super(roomName, variation, variationInfo, wallMatrix, exitMatrix);

		// Use a max level 6 room plan.
		this.roomPlan = new RoomPlan(this.roomName, null, 6);
		this.placementManager = new PlacementManager(this.roomPlan, new PathFinder.CostMatrix(), wallMatrix, exitMatrix);

		hivemind.log('rooms', this.roomName).info('Started generating stripmine room plan for variation', variation);

		this.steps = [
			this.gatherExitCoords,
			this.determineCorePosition,
			this.determineHarvesterPositions,
			this.determineUpgraderPosition,
			this.placeRoadNetwork,
			this.placeRoomCore,
			this.placeHarvestBayStructures,
			this.placeBays,
			this.placeRamparts,
			this.sealRoom,
			this.placeTowers,
			this.placeRoadsToRamps,
			this.placeOnRamps,
		];
	}

}
